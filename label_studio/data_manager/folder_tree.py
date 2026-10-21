"""Build navigation folders from imported task links, without scanning the filesystem."""

from pathlib import PurePosixPath, PureWindowsPath


def build_folder_tree(rows):
    roots = {}
    for row in rows:
        raw_root = row['storage__path']
        raw_key = row['key']
        path_type = PureWindowsPath if '\\' in raw_root or PureWindowsPath(raw_root).drive else PurePosixPath
        root = path_type(raw_root)
        key = path_type(raw_key)
        try:
            parts = key.relative_to(root).parts
        except ValueError:
            continue
        if not parts or '..' in parts:
            continue
        separator = '\\' if path_type is PureWindowsPath else '/'

        def node(path, name):
            return {'name': name, 'prefix': str(path).rstrip('/\\') + separator, 'count': 0, 'children': {}}

        storage_id = row['storage_id']
        current = roots.setdefault(storage_id, node(root, root.name or str(root)))
        count = row['task_count']
        current['count'] += count
        directory = root
        for part in parts[:-1]:
            directory = directory / part
            current = current['children'].setdefault(part, node(directory, part))
            current['count'] += count

    def serialize(nodes):
        return [
            {**item, 'children': serialize(item['children'].values())}
            for item in sorted(nodes, key=lambda item: (item['name'].casefold(), item['prefix']))
        ]

    return serialize(roots.values())
