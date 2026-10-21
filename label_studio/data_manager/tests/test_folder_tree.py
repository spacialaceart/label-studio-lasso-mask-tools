import unittest

from data_manager.folder_tree import build_folder_tree


class FolderTreeTests(unittest.TestCase):
    def row(self, key, root='/coral/chosen', count=1, storage=1):
        return {'storage_id': storage, 'storage__path': root, 'key': key, 'task_count': count}

    def test_nested_counts_include_direct_files_and_children(self):
        tree = build_folder_tree([
            self.row('/coral/chosen/2024/deep/a.jpg', count=2),
            self.row('/coral/chosen/2016/b.jpg'),
            self.row('/coral/chosen/root.jpg'),
        ])
        self.assertEqual(tree[0]['count'], 4)
        self.assertEqual([node['name'] for node in tree[0]['children']], ['2016', '2024'])
        year = tree[0]['children'][1]
        self.assertEqual(year['prefix'], '/coral/chosen/2024/')
        self.assertEqual(year['count'], 2)
        self.assertEqual(year['children'][0]['name'], 'deep')

    def test_windows_spaces_and_case_insensitive_containment(self):
        root = r'E:\Coral Data\chosen'
        tree = build_folder_tree([self.row(r'e:\Coral Data\chosen\2016\photo.JPG', root)])
        self.assertEqual(tree[0]['children'][0]['prefix'], root + '\\2016\\')

    def test_skip_sibling_roots_and_parent_traversal(self):
        self.assertEqual(build_folder_tree([
            self.row('/coral/chosen-other/photo.jpg'),
            self.row('/coral/chosen/../private/photo.jpg'),
        ]), [])

    def test_multiple_storages_and_empty_project(self):
        self.assertEqual(build_folder_tree([]), [])
        tree = build_folder_tree([
            self.row('/coral/chosen/2016/a.jpg'),
            self.row('/other/chosen/2016/b.jpg', root='/other/chosen', storage=2),
        ])
        self.assertEqual(len(tree), 2)
        self.assertEqual([root['count'] for root in tree], [1, 1])
