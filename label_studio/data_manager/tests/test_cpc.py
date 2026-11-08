import tempfile
import unittest
from pathlib import Path

from data_manager.cpc import load_overlay, read_cpc, read_dictionary, signature


class CPCTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.folder = self.root / '2019'
        self.folder.mkdir()
        self.image = self.folder / 'coral.JPG'
        self.dictionary = self.root / 'Master_Coral_Codes_NACRE_TUBB_DRAFT_40.txt'
        self.dictionary.write_text('DFDFDF\nAFAFAF\nDFDFDF\nAFAFAF\n1\n"HC","coral",DFDFDF\n"POC","Pocillopora","HC"\n')
        self.cpc = self.image.with_suffix('.cpc')
        self.write_cpc()
        read_cpc.cache_clear()
        read_dictionary.cache_clear()

    def write_cpc(self, coordinates='50,25', code='POC', dictionary=None):
        name = dictionary or self.dictionary.name
        self.cpc.write_text(f'"C:\\old\\{name}","old.JPG",100,100,20,20\n0,0\n100,0\n100,100\n0,100\n1\n{coordinates}\n"A","{code}","Notes","example"\n')

    def test_coordinates_and_meanings_from_parent_dictionary(self):
        result = load_overlay(self.image, self.root)
        point = result['points'][0]
        self.assertEqual((point['x'], point['y']), (0.5, 0.25))
        self.assertEqual((point['description'], point['group'], point['notes']), ('Pocillopora', 'coral', 'example'))
        self.assertIsNone(result['warning'])

    def test_cache_reuse_and_dictionary_invalidation(self):
        load_overlay(self.image, self.root)
        load_overlay(self.image, self.root)
        self.assertEqual(read_cpc.cache_info().hits, 1)
        self.assertEqual(read_dictionary.cache_info().hits, 1)
        self.dictionary.write_text('DFDFDF\nAFAFAF\n1\n"HC","coral",DFDFDF\n"POC","Updated meaning","HC"\n')
        self.assertEqual(load_overlay(self.image, self.root)['points'][0]['description'], 'Updated meaning')
        self.write_cpc(coordinates='75,25')
        self.assertEqual(load_overlay(self.image, self.root)['points'][0]['x'], 0.75)

    def test_missing_or_unrecognized_dictionary_preserves_code(self):
        self.write_cpc(dictionary='untrusted.txt')
        result = load_overlay(self.image, self.root)
        self.assertTrue(result['warning'])
        self.assertEqual(result['points'][0]['code'], 'POC')
        self.assertEqual(result['points'][0]['description'], 'Unknown code')

    def test_dictionaries_outside_document_root_are_not_read(self):
        self.assertTrue(load_overlay(self.image, self.folder)['warning'])

    def test_nonfinite_and_out_of_range_coordinates(self):
        for value in ('nan,25', 'inf,25', '-1,25', '101,25'):
            with self.subTest(value=value):
                self.write_cpc(coordinates=value)
                with self.assertRaises(ValueError):
                    load_overlay(self.image, self.root)

    def test_truncated_file(self):
        self.cpc.write_text('"bad"\n')
        with self.assertRaises(ValueError):
            read_cpc(*signature(self.cpc))

    def test_unknown_code_is_retained(self):
        self.write_cpc(code='UNKNOWN')
        result = load_overlay(self.image, self.root)
        self.assertEqual(result['points'][0]['code'], 'UNKNOWN')
        self.assertEqual(result['points'][0]['description'], 'Unknown code')
