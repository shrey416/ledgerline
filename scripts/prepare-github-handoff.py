"""Package reviewed source in contribution order; never initialize, commit or push Git."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'handoff'
STAGES = [
    ('01-you-foundation-python', ['.gitignore', '.dockerignore', '.prettierignore', '.prettierrc.json',
        'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
        'vitest.config.ts', 'playwright.config.ts', 'design.md', 'phases.md',
        'compose.yaml', 'compose.daily.yaml', 'infra', 'observability', 'services/README.md', 'services/capture-automation']),
    ('02-parth-go', ['services/rates-realtime']),
    ('03-sneh-csharp', ['services/analytics']),
    ('04-dhrumil-java', ['services/core-finance']),
    ('05-riya-nodejs', ['services/notifications']),
    ('06-you-frontend', ['apps', 'index.html', 'tests']),
    ('07-you-integration', ['scripts', 'docs', 'implementation', 'README.md']),
]


def allowed(path):
    rel = path.relative_to(ROOT)
    if set(rel.parts) & {'node_modules', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', '.m2'}:
        return False
    name = path.name
    if name == '.env' or (name.startswith('.env.') and not name.endswith('.example')):
        return False
    if name.endswith(('.log', '.pyc', '.tsbuildinfo')):
        return False
    if rel.as_posix() in {
        'infra/local/email.env', 'infra/local/s3-credentials.json',
        'infra/local/runtime-profile.json', 'infra/k8s/rendered.yaml',
        'implementation/runtime-evidence.json',
    }:
        return False
    return not rel.as_posix().startswith('infra/k8s/local/generated/')


def main():
    selected = []
    seen = set()
    for name, roots in STAGES:
        files = []
        for entry in roots:
            source = ROOT / entry
            if not source.exists():
                raise SystemExit(f'Missing stage source: {entry}')
            for path in sorted(source.rglob('*')) if source.is_dir() else [source]:
                if path.is_file() and allowed(path):
                    rel = path.relative_to(ROOT).as_posix()
                    if rel in seen:
                        raise SystemExit(f'Duplicate ownership: {rel}')
                    seen.add(rel)
                    files.append(path)
        selected.append((name, files))
    # Compare local credential VALUES without printing or copying them.
    private_values = []
    for filename in ['infra/local/.env', 'infra/local/email.env']:
        source = ROOT / filename
        if source.exists():
            for line in source.read_text(encoding='utf-8-sig').splitlines():
                if '=' in line and not line.startswith('#'):
                    key, value = line.split('=', 1)
                    if any(word in key for word in ['PASSWORD', 'SECRET', 'ENCRYPTION_KEY']) and len(value) >= 12:
                        private_values.append(value.encode())
    for _, files in selected:
        for path in files:
            contents = path.read_bytes()
            if any(value in contents for value in private_values):
                raise SystemExit(f'Credential match; packaging blocked: {path.relative_to(ROOT)}')
    OUTPUT.mkdir(exist_ok=True)
    manifest = []
    for name, files in selected:
        archive = OUTPUT / f'{name}.zip'
        with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
            for path in files:
                bundle.write(path, path.relative_to(ROOT).as_posix())
        entries = [dict(path=path.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in files]
        (OUTPUT / f'{name}.files.txt').write_text('\n'.join(item['path'] for item in entries) + '\n', encoding='utf-8')
        manifest.append(dict(stage=name, files=entries, archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest()))
        print(f'{archive.name}: {len(files)} source files')
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('No Git commands executed. Local credential values were excluded and checked.')


if __name__ == '__main__':
    main()
