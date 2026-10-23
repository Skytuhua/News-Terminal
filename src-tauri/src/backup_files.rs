use crate::{db, Backend, RequestBudget};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{BufReader, BufWriter, Write},
    path::Path,
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub(crate) struct Selected {
    id: String,
    window: String,
    token: String,
    file: File,
}

fn take_selected(state: &Backend, owner: &str, request: &Value) -> Result<File, String> {
    if request["confirmed"] != true {
        return Err("Confirm that importing replaces the current local data".into());
    }
    let id = db::text(request, "fileId", 200)?;
    let token = db::text(request, "replacementToken", 200)?;
    let mut selected = state
        .backup_file
        .lock()
        .map_err(|_| "Backup selection is unavailable")?;
    if selected
        .as_ref()
        .is_none_or(|s| s.id != id || s.window != owner || s.token != token)
    {
        return Err("Backup selection changed; choose the file again".into());
    }
    Ok(selected.take().unwrap().file)
}

fn write_atomic(
    path: &Path,
    data_directory: &Path,
    export: impl FnOnce(&mut BufWriter<&mut File>) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose a backup destination")?;
    if path
        .extension()
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("Choose a .json backup filename".into());
    }
    if parent
        .canonicalize()
        .map_err(|_| "Backup destination is unavailable")?
        == data_directory
            .canonicalize()
            .map_err(|_| "Application data directory is unavailable")?
    {
        return Err("Save the backup outside the active application data directory".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create backup; check disk space and access")?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        export(&mut writer)?;
        writer
            .flush()
            .map_err(|_| "Could not finish the backup; check disk space")?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Could not finish writing the backup")?;
    temporary
        .persist(path)
        .map_err(|_| "Could not replace the backup file")?;
    Ok(())
}

pub(crate) async fn handle(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    RequestBudget(64 * 1024).check(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Backend>();
        match request["op"].as_str().unwrap_or("") {
            "backup_choose_file" => {
                state.database()?.require_replacement(&request)?;
                let Some(path) = app.dialog().file().set_parent(&window)
                    .add_filter("JSON backup", &["json"]).blocking_pick_file() else { return Ok(Value::Null); };
                let path = path.into_path().map_err(|_| "Choose a local backup file")?;
                let file = File::open(&path).map_err(|_| "Could not open the selected backup")?;
                state.database()?.require_replacement(&request)?;
                let id = uuid::Uuid::new_v4().to_string();
                *state.backup_file.lock().map_err(|_| "Backup selection is unavailable")? = Some(Selected {
                    id: id.clone(), window: window.label().into(), token: request["replacementToken"].as_str().unwrap().into(), file,
                });
                Ok(json!({"id":id,"name":path.file_name().unwrap_or_default().to_string_lossy()}))
            }
            "backup_import_file" => {
                let file = take_selected(&state, window.label(), &request)?;
                state.replace_database(|database| {
                    database.require_replacement(&request)?;
                    database.import_reader(BufReader::new(file))
                }).map_err(|error| format!("{error}. Choose the backup file again to retry."))?;
                Ok(Value::Null)
            }
            "backup_export_file" => {
                let Some(path) = app.dialog().file().set_parent(&window)
                    .add_filter("JSON backup", &["json"]).set_file_name("news-terminal-backup.json")
                    .blocking_save_file() else { return Ok(json!({"saved":false})); };
                let path = path.into_path().map_err(|_| "Choose a local backup destination")?;
                let directory = std::env::var_os("NEWS_TERMINAL_DATA_DIR").map(std::path::PathBuf::from)
                    .map(Ok).unwrap_or_else(|| app.path().app_data_dir().map_err(|_| "Application data directory is unavailable"))?;
                let database = state.database()?;
                write_atomic(&path, &directory, |writer| database.export_writer(writer))?;
                Ok(json!({"saved":true,"name":path.file_name().unwrap_or_default().to_string_lossy()}))
            }
            _ => Err("Unknown backup file operation".into()),
        }
    }).await.map_err(|_| "Backup file operation failed")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_export_preserves_existing_backup_and_cleans_temporary_file() {
        let destination = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let path = destination.path().join("backup.json");
        std::fs::write(&path, b"original backup").unwrap();
        assert!(write_atomic(&path, data.path(), |writer| {
            writer.write_all(b"incomplete replacement").unwrap();
            Err("disk fixture failure".into())
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original backup");
        assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 1);
        write_atomic(&path, data.path(), |writer| {
            writer.write_all(b"new backup").map_err(|e| e.to_string())
        })
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new backup");
        assert!(write_atomic(
            &data.path().join("workspace-windows.json"),
            data.path(),
            |_| panic!("must reject before writing")
        )
        .is_err());
    }

    #[test]
    fn chosen_file_requires_confirmation_owner_and_original_replacement_token() {
        let state = Backend::new(db::Database::memory().unwrap());
        *state.backup_file.lock().unwrap() = Some(Selected {
            id: "chosen".into(),
            window: "main".into(),
            token: "token".into(),
            file: tempfile::tempfile().unwrap(),
        });
        let request = json!({"fileId":"chosen","replacementToken":"token","confirmed":true});
        for (owner, patch) in [
            ("other", json!({})),
            ("main", json!({"confirmed":false})),
            ("main", json!({"replacementToken":"new"})),
            ("main", json!({"fileId":"missing"})),
        ] {
            let mut invalid = request.clone();
            invalid
                .as_object_mut()
                .unwrap()
                .extend(patch.as_object().unwrap().clone());
            assert!(take_selected(&state, owner, &invalid).is_err());
        }
        assert!(take_selected(&state, "main", &request).is_ok());
        assert!(take_selected(&state, "main", &request).is_err());
    }
}
