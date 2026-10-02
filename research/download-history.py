"""Fetch checksum-verified public spot archives; never touch the bot account.

Source: https://github.com/binance/binance-public-data
Spot archive timestamps change from milliseconds to microseconds in 2025.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'audit-output' / 'strategy-improvement'
ARCHIVES = OUT / 'archives'


def fetch(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def download(task):
    symbol, year, month = task
    filename = f'{symbol}-15m-{year}-{month:02}.zip'
    url = f'https://data.binance.vision/data/spot/monthly/klines/{symbol}/15m/{filename}'
    target = ARCHIVES / filename
    checksum_file = ARCHIVES / (filename + '.CHECKSUM')
    if not checksum_file.exists():
        checksum_file.write_bytes(fetch(url + '.CHECKSUM'))
    expected = checksum_file.read_text().split()[0]
    payload = target.read_bytes() if target.exists() else fetch(url)
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected:
        raise ValueError(f'Checksum mismatch: {filename}')
    if not target.exists():
        target.write_bytes(payload)
    # Read the member in memory; never extract untrusted archive paths.
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        member = filename.replace('.zip', '.csv')
        rows = archive.read(member).decode('utf-8').splitlines()
    return {'symbol': symbol, 'url': url, 'sha256': actual, 'rows': len(rows)}, rows


def main():
    ARCHIVES.mkdir(parents=True, exist_ok=True)
    protocol = json.loads((ROOT / 'research' / 'strategy-protocol.json').read_text())
    tasks = [(s, y, m) for s in protocol['symbols'] for y in range(2022, 2026) for m in range(1, 13)]
    manifest = []
    data = {s: [] for s in protocol['symbols']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i, (item, rows) in enumerate(pool.map(download, tasks)):
            manifest.append(item)
            data[item['symbol']].extend(rows)
            if i % 12 == 0:
                print(f'Verified archive {i+1}/{len(tasks)}: {item["url"]}', flush=True)
    for symbol, rows in data.items():
        (OUT / f'{symbol}-15m.csv').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    (OUT / 'download-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Completed checksum-verified 2022–2025 history for both assets.', flush=True)


if __name__ == '__main__':
    main()
