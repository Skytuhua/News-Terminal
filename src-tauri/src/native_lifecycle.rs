//! Window ownership changes and database replacement share one lifecycle.
#[derive(Default)]
pub(crate) struct NativeLifecycle {
    gate: tokio::sync::Mutex<()>,
}

impl NativeLifecycle {
    pub(crate) async fn acquire(&self, op: &str) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        if matches!(
            op,
            "detach_tab" | "reattach_tab" | "import" | "backup_import_file"
        ) {
            Some(self.gate.lock().await)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;
    use std::{collections::BTreeSet, sync::Mutex};

    struct Workspace {
        database: Mutex<Database>,
        windows: Mutex<BTreeSet<(String, String)>>,
        order: Mutex<Vec<&'static str>>,
        profile: String,
        replacement: String,
    }
    impl Workspace {
        fn new() -> Self {
            let mut database = Database::memory().unwrap();
            let profile = database
                .request(&json!({"op":"profile_create","name":"Old owner"}), 1000)
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_owned();
            Self {
                database: Mutex::new(database),
                windows: Mutex::new(BTreeSet::new()),
                order: Mutex::new(Vec::new()),
                profile,
                replacement: Database::memory().unwrap().export().unwrap(),
            }
        }
        fn valid_owner(&self) -> bool {
            self.order.lock().unwrap().push("validate");
            self.database
                .lock()
                .unwrap()
                .workspace_owner_exists(&self.profile, Some("home"))
                .unwrap()
        }
        fn create(&self) {
            self.order.lock().unwrap().push("create");
            self.windows
                .lock()
                .unwrap()
                .insert((self.profile.clone(), "home".into()));
        }
        fn replace(&self) {
            self.order.lock().unwrap().push("replace");
            self.database
                .lock()
                .unwrap()
                .import(&self.replacement)
                .unwrap();
        }
        fn reconcile(&self) {
            self.order.lock().unwrap().push("reconcile");
            let database = self.database.lock().unwrap();
            self.windows.lock().unwrap().retain(|(profile, tab)| {
                database.workspace_owner_exists(profile, Some(tab)).unwrap()
            });
        }
    }

    #[tokio::test]
    async fn detach_creation_finishes_before_either_import_can_replace_and_reconcile() {
        for import_op in ["import", "backup_import_file"] {
            let lifecycle = NativeLifecycle::default();
            let workspace = Workspace::new();
            let (create, wait_for_create) = tokio::sync::oneshot::channel();
            let mut detach = Box::pin(async {
                let _guard = lifecycle
                    .acquire("detach_tab")
                    .await
                    .expect("detach requires a lifecycle guard");
                assert!(workspace.valid_owner());
                // The paused native dispatcher owns neither SQLite nor layout.
                assert!(workspace.database.try_lock().is_ok());
                assert!(workspace.windows.try_lock().is_ok());
                wait_for_create.await.unwrap();
                workspace.create();
            });
            assert!(futures_util::poll!(&mut detach).is_pending());
            let mut import = Box::pin(async {
                let _guard = lifecycle
                    .acquire(import_op)
                    .await
                    .expect("both import routes require the lifecycle guard");
                workspace.replace();
                workspace.reconcile();
            });
            assert!(futures_util::poll!(&mut import).is_pending());
            assert_eq!(*workspace.order.lock().unwrap(), ["validate"]);
            create.send(()).unwrap();
            detach.await;
            import.await;
            assert_eq!(
                *workspace.order.lock().unwrap(),
                ["validate", "create", "replace", "reconcile"]
            );
            assert!(workspace.windows.lock().unwrap().is_empty());
            assert!(!workspace
                .database
                .lock()
                .unwrap()
                .workspace_owner_exists(&workspace.profile, Some("home"))
                .unwrap());
        }
    }

    #[tokio::test]
    async fn either_import_finishes_reconciliation_before_window_owner_validation() {
        for import_op in ["import", "backup_import_file"] {
            for window_op in ["detach_tab", "reattach_tab"] {
                let lifecycle = NativeLifecycle::default();
                let workspace = Workspace::new();
                workspace.create();
                workspace.order.lock().unwrap().clear();
                let (reconcile, wait_for_reconcile) = tokio::sync::oneshot::channel();
                let mut import = Box::pin(async {
                    let _guard = lifecycle
                        .acquire(import_op)
                        .await
                        .expect("import requires a lifecycle guard");
                    workspace.replace();
                    assert!(workspace.database.try_lock().is_ok());
                    assert!(workspace.windows.try_lock().is_ok());
                    wait_for_reconcile.await.unwrap();
                    workspace.reconcile();
                });
                assert!(futures_util::poll!(&mut import).is_pending());
                let mut window = Box::pin(async {
                    let _guard = lifecycle
                        .acquire(window_op)
                        .await
                        .expect("window ownership changes require the lifecycle guard");
                    if workspace.valid_owner() {
                        workspace.create();
                    }
                });
                assert!(futures_util::poll!(&mut window).is_pending());
                assert_eq!(*workspace.order.lock().unwrap(), ["replace"]);
                reconcile.send(()).unwrap();
                import.await;
                window.await;
                assert_eq!(
                    *workspace.order.lock().unwrap(),
                    ["replace", "reconcile", "validate"]
                );
                assert!(workspace.windows.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn ordinary_reads_do_not_wait_for_window_ownership_changes() {
        let lifecycle = NativeLifecycle::default();
        let _guard = lifecycle
            .acquire("detach_tab")
            .await
            .expect("detach requires a lifecycle guard");
        for op in [
            "snapshot",
            "window_context",
            "workspace_get",
            "backup_choose_file",
            "backup_export_file",
        ] {
            assert!(
                lifecycle.acquire(op).await.is_none(),
                "{op} must not join the ownership lifecycle"
            );
        }
    }
}
