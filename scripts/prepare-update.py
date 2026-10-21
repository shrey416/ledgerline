"""Create a credential-checked source overlay without changing the handoff ZIPs."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import runpy

ROOT = Path(__file__).resolve().parents[1]
config = runpy.run_path(str(ROOT / 'scripts/prepare-github-handoff.py'))
files = {}
for _, roots in config['STAGES']:
    for entry in roots:
        source = ROOT / entry
        for path in sorted(source.rglob('*')) if source.is_dir() else [source]:
            if path.is_file() and config['allowed'](path):
                files[path.relative_to(ROOT).as_posix()] = path
files['UPDATE-README.md'] = ROOT / 'UPDATE-README.md'
private_values = []
for name in ['infra/local/.env', 'infra/local/email.env']:
    path = ROOT / name
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                if any(word in key for word in ['PASSWORD', 'SECRET', 'ENCRYPTION_KEY']) and len(value) >= 12:
                    private_values.append(value.encode())
payload = {}
for name, path in sorted(files.items()):
    contents = path.read_bytes()
    if any(value in contents for value in private_values):
        raise SystemExit(f'Credential match; packaging blocked: {name}')
    payload[name] = contents
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}
output = ROOT / 'handoff/ledgerline-current-update.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name, data in payload.items():
        archive.writestr(name, data)
    archive.writestr('UPDATE-MANIFEST.json', json.dumps(manifest, indent=2))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    assert 'scripts/start.ps1' in archive.namelist()
    assert 'scripts/update-and-start.ps1' in archive.namelist()
print(f'{output}: {len(payload)} source files, {output.stat().st_size:,} bytes')
print('Archive integrity and all source hashes verified; local credential values checked and excluded.')
