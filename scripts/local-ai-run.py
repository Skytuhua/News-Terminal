"""Run only the project-owned Ollama server. No service, startup task or global env edits."""
from pathlib import Path
import json
import os
import socket
import subprocess

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local-ai'
EXE = LOCAL / 'ollama-0.34.3' / 'ollama.exe'


def main():
    if not EXE.is_file():
        raise SystemExit('Run python scripts/local-ai-setup.py first.')
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 11434)) == 0:
            raise SystemExit('Port 11434 is occupied; refusing to replace an existing service.')
    home, temp = LOCAL / 'home', LOCAL / 'temp'
    for path in (home, temp, LOCAL / 'models', home / 'AppData/Local', home / 'AppData/Roaming'):
        path.mkdir(parents=True, exist_ok=True)
    # A minimal allowlist avoids inheriting any API credentials or cloud/proxy settings.
    windows = os.environ.get('SystemRoot', r'C:\Windows')
    env = {
        'SystemRoot': windows, 'WINDIR': windows, 'SystemDrive': Path(windows).drive,
        'COMSPEC': str(Path(windows) / 'System32/cmd.exe'),
        'PATH': str(EXE.parent) + ';' + str(Path(windows) / 'System32') + ';' + windows,
        'TEMP': str(temp), 'TMP': str(temp), 'USERPROFILE': str(home), 'HOME': str(home),
        'HOMEDRIVE': home.drive, 'HOMEPATH': str(home)[len(home.drive):],
        'LOCALAPPDATA': str(home / 'AppData/Local'), 'APPDATA': str(home / 'AppData/Roaming'),
        'OLLAMA_HOST': '127.0.0.1:11434', 'OLLAMA_MODELS': str(LOCAL / 'models'),
        'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NOHISTORY': '1', 'OLLAMA_DEBUG_LOG_REQUESTS': '0',
        'OLLAMA_CONTEXT_LENGTH': '4096', 'OLLAMA_NUM_PARALLEL': '1',
        'OLLAMA_MAX_LOADED_MODELS': '1', 'OLLAMA_KEEP_ALIVE': '15m',
        'OLLAMA_VULKAN': '0', 'OLLAMA_IGPU_ENABLE': '0',
    }
    with (LOCAL / 'server.log').open('a', encoding='utf-8') as log:
        process = subprocess.Popen([str(EXE), 'serve'], cwd=LOCAL, env=env,
                                   stdout=log, stderr=subprocess.STDOUT)
        (LOCAL / 'server-process.json').write_text(json.dumps({
            'pid': process.pid, 'launcher_pid': os.getpid(), 'executable': str(EXE),
            'endpoint': 'http://127.0.0.1:11434', 'models': str(LOCAL / 'models'),
        }, indent=2), encoding='utf-8')
        print(f'Ollama PID {process.pid}; http://127.0.0.1:11434; log .local-ai/server.log', flush=True)
        try:
            raise SystemExit(process.wait())
        except KeyboardInterrupt:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)


if __name__ == '__main__':
    main()
