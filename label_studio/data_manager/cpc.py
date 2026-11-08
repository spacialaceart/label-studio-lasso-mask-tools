"""Read CPCE sidecars without modifying source images or point files."""

import csv
import math
from functools import lru_cache
from pathlib import Path, PureWindowsPath


CODE_FILES = frozenset(
    name.casefold()
    for name in (
        'Master_Coral_Codes_NACRE_TUBB_DRAFT.txt',
        'Master_Coral_Codes_NACRE_TUBB_DRAFT_40.txt',
        'Master_Coral_Codes_HISTORICAL_CA_RCK_DRAFT.txt',
    )
)


def signature(path):
    stat = path.stat()
    return str(path), stat.st_mtime_ns, stat.st_size


def rows(path):
    path = Path(path)
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('CPCE file exceeds the 4 MB limit')
    raw = path.read_bytes()
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('cp1252')
    return [[cell.strip() for cell in row] for row in csv.reader(text.splitlines(), skipinitialspace=True)]


@lru_cache(maxsize=16)
def read_dictionary(path, modified, size):
    data = rows(path)
    # Older files have two color lines; the 4.0 variant has four.
    start = next((i for i in (2, 4) if len(data) > i and len(data[i]) == 1
                  and data[i][0].isdigit() and 0 < int(data[i][0]) <= 1000
                  and len(data) > i + 1 and len(data[i + 1]) == 3), None)
    if start is None:
        raise ValueError('Invalid CPCE dictionary header')
    count = int(data[start][0])
    categories = data[start + 1 : start + 1 + count]
    if len(categories) != count or any(len(row) != 3 for row in categories):
        raise ValueError('Invalid CPCE dictionary categories')
    groups = {code: description for code, description, color in categories}
    result = {}
    for row in data[start + 1 + count :]:
        if not row or row == ['']:
            continue
        if len(row) != 3:
            raise ValueError('Invalid CPCE dictionary entry')
        code, description, group = row
        result[code] = {'description': description, 'group': groups.get(group, group), 'group_code': group}
    return result


@lru_cache(maxsize=256)
def read_cpc(path, modified, size):
    data = rows(path)
    try:
        header = data[0]
        width, height = float(header[2]), float(header[3])
        if not all(math.isfinite(v) and v > 0 for v in (width, height)):
            raise ValueError('Invalid CPCE image dimensions')
        count = int(data[5][0])
        if not 0 <= count <= 10000 or len(data) < 6 + count * 2:
            raise ValueError('Invalid CPCE point count')
        points = []
        for i in range(count):
            x, y = map(float, data[6 + i])
            if not (math.isfinite(x) and math.isfinite(y) and 0 <= x <= width and 0 <= y <= height):
                raise ValueError('CPCE point outside the image')
            label, code, *notes = data[6 + count + i]
            points.append({'x': x / width, 'y': y / height, 'label': label, 'code': code,
                           'notes': ' / '.join(n for n in notes if n and n != 'Notes')})
        return PureWindowsPath(header[0]).name, points
    except (IndexError, TypeError) as exc:
        raise ValueError('Invalid CPCE point file') from exc


def load_overlay(image_path, document_root):
    image_path, root = Path(image_path).resolve(), Path(document_root).resolve()
    cpc = image_path.with_suffix('.cpc')
    if not cpc.exists():
        cpc = image_path.with_suffix('.CPC')
    if not cpc.resolve().is_relative_to(root) or cpc.resolve().parent != image_path.parent:
        raise ValueError('CPCE sidecar must be beside the image within local storage')
    dictionary_name, points = read_cpc(*signature(cpc))
    dictionary = None
    # Only recognized dictionaries in the image folder or its immediate parent.
    # Never follow the arbitrary absolute path recorded in a CPC header.
    if dictionary_name.casefold() in CODE_FILES:
        for directory in (image_path.parent, image_path.parent.parent):
            candidate = (directory / dictionary_name).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                dictionary = candidate
                break
    meanings = read_dictionary(*signature(dictionary)) if dictionary else {}
    return {
        'file': cpc.name,
        'dictionary': dictionary_name,
        'warning': None if dictionary else 'Code dictionary not found; showing original codes.',
        'points': [dict(point, **meanings.get(point['code'], {
            'description': 'Unknown code', 'group': '', 'group_code': '',
        })) for point in points],
    }
