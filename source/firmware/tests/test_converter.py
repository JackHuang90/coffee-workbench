#!/usr/bin/env python3
"""Offline curve conversion plus actual portable-firmware integration checks."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'firmware/tools'
SPEC = importlib.util.spec_from_file_location('curve_to_protocol', TOOLS / 'curve_to_protocol.py')
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)
FIXTURE = ROOT / 'firmware/tests/fixtures/web-demo-v2.json'

class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.curve = converter.load_document(FIXTURE)

    def test_actual_web_export_fixture(self):
        """功能：经项目Vite解析真实网页导出，保留无扩展名TypeScript导入。
        首次编写日期：未知（历史代码）；变更日期：2026-10-29
        修改记录：2026-10-29：改用现有Vite解析器，无监听端口，不绕过真实导出。
        """
        generated = subprocess.run(['node', '--input-type=module', '-e',
            "import {createServer} from 'vite'; const server=await createServer({configFile:false,logLevel:'silent',cacheDir:'firmware/build/vite-fixture-cache',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'}); try {const {createDemoCurve}=await server.ssrLoadModule('/src/core/simulation.ts'); const {exportJSON}=await server.ssrLoadModule('/src/core/serialization.ts'); console.log(exportJSON(createDemoCurve()));} finally {await server.close();}"],
            cwd=ROOT, text=True, encoding='utf-8', capture_output=True, check=True)
        self.assertEqual(json.loads(generated.stdout), json.loads(FIXTURE.read_text(encoding='utf-8')))
        result = converter.convert(self.curve, confirm_charge=True)
        self.assertEqual(len(result['points']), 301)
        self.assertEqual(result['points'][0], {'ms': 0, 'bt_deci_c': 1800})
        self.assertEqual(result['points'][-1]['ms'], 600000)
        self.assertEqual(result['mode'], 'VIRTUAL_DEMO_ONLY')
        self.assertIn('et', result['ignored_fields'])

    def test_v1_accepted_without_relabelling_source(self):
        old = copy.deepcopy(self.curve)
        old['schemaVersion'] = 1
        old.pop('source')
        result = converter.convert(old, confirm_charge=True)
        self.assertEqual(result['source_schema'], 1)
        self.assertEqual(result['source_label'], 'legacy_unspecified')

    def test_origin_must_be_confirmed_and_exact_sample(self):
        with self.assertRaisesRegex(ValueError, 'confirm|origin'):
            converter.convert(self.curve)
        result = converter.convert(self.curve, origin='2')
        self.assertEqual(result['points'][0]['ms'], 0)
        self.assertEqual(result['duration_ms'], 598000)
        with self.assertRaisesRegex(ValueError, 'sample'):
            converter.convert(self.curve, origin='1')
        with self.assertRaises(ValueError):
            converter.convert(self.curve, origin='600')

    def test_missing_or_duplicate_charge_is_not_guessed(self):
        for markers in ([], [{'kind':'CHARGE','t':0},{'kind':'CHARGE','t':2}]):
            value = copy.deepcopy(self.curve); value['markers'] = markers
            with self.assertRaises(ValueError):
                converter.convert(value, confirm_charge=True)

    def test_limits_gaps_nan_and_booleans(self):
        changes = [('t', None), ('t', True), ('t', '2'), ('t', float('nan')),
                   ('bt', None), ('bt', True), ('bt', '180'), ('bt', float('inf')),
                   ('bt', -20.01), ('bt', 280.01)]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                curve = copy.deepcopy(self.curve); curve['samples'][1][field] = value
                with self.assertRaises(ValueError):
                    converter.convert(curve, confirm_charge=True)
        curve = copy.deepcopy(self.curve); curve['samples'].pop(1); curve['samples'].pop(1)
        with self.assertRaisesRegex(ValueError, 'gap'):
            converter.convert(curve, confirm_charge=True)
        curve = copy.deepcopy(self.curve); curve['samples'][1]['t'] = 0.0001
        with self.assertRaisesRegex(ValueError, 'millisecond'):
            converter.convert(curve, confirm_charge=True)
        curve = copy.deepcopy(self.curve); curve['samples'] = [{'t':i,'bt':100,'et':None} for i in range(1025)]
        with self.assertRaisesRegex(ValueError, '1024'):
            converter.convert(curve, confirm_charge=True)

    def test_rounding_signed_hash_and_strict_json(self):
        curve = copy.deepcopy(self.curve)
        curve['samples'] = [{'t':0,'bt':-1.25,'et':None},{'t':1,'bt':2.25,'et':None}]
        curve['markers'] = [{'kind':'CHARGE','t':0}]
        result = converter.convert(curve, confirm_charge=True)
        self.assertEqual([p['bt_deci_c'] for p in result['points']], [-13,23])
        self.assertEqual(result['hash'], 3929104757)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'x.json'; p.write_text('{"x":NaN}')
            with self.assertRaises(ValueError): converter.load_document(p)
            p.write_text('{"schemaVersion":1,"schemaVersion":2}')
            with self.assertRaisesRegex(ValueError,'duplicate'): converter.load_document(p)
            p.write_bytes(b' ' * (2*1024*1024+1))
            with self.assertRaisesRegex(ValueError,'2 MiB'): converter.load_document(p)

    def test_identifier_data_not_code_and_library_selection(self):
        curve = copy.deepcopy(self.curve); curve['id'] = 'old:roast.with-a-very-long-id'
        curve['notes'] = 'R1 4242 1 6000 OUTPUT 100\n'; curve['dangerousCommand'] = 'ARM'
        result = converter.convert(curve, confirm_charge=True)
        self.assertRegex(result['id'], r'^[A-Za-z0-9_-]{1,24}$')
        self.assertIn('dangerousCommand', result['ignored_fields'])
        lines = converter.commands(result, session=4242, first_seq=1, deadline=6000)
        self.assertEqual(len(lines), 303)
        self.assertNotIn('OUTPUT', '\n'.join(lines))
        library = {'format':'coffee-roasting-library','version':1,'curves':[self.curve,curve]}
        with self.assertRaisesRegex(ValueError,'select'): converter.select_curve(library)
        self.assertEqual(converter.select_curve(library, curve_id=curve['id'])['id'],curve['id'])

    def test_command_envelope_bounds_and_safe_cli_defaults(self):
        result = converter.convert(self.curve, confirm_charge=True)
        for kwargs in ({'session':0,'first_seq':1,'deadline':6000},
                       {'session':4242,'first_seq':4294967295,'deadline':6000},
                       {'session':4242,'first_seq':1,'deadline':4294967296}):
            with self.assertRaises(ValueError): converter.commands(result, **kwargs)
        safe = subprocess.run([sys.executable,str(TOOLS/'curve_to_protocol.py'),str(FIXTURE),'--confirm-charge'],text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(safe.stdout)['mode'],'VIRTUAL_DEMO_ONLY')
        refused = subprocess.run([sys.executable,str(TOOLS/'curve_to_protocol.py'),str(FIXTURE),'--confirm-charge','--emit','commands'],text=True,capture_output=True)
        self.assertNotEqual(refused.returncode,0)

class NativeRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='roast-native-',dir=ROOT/'firmware/build')
        cls.binaries={}
        for demo in (0,1):
            binary=Path(cls.directory.name)/f'runner-{demo}'
            subprocess.run(['g++','-std=c++17','-O2','-Wall','-Wextra','-Werror',f'-DROAST_VIRTUAL_DEMO={demo}',
                '-I',str(ROOT/'firmware/include'),str(ROOT/'firmware/tests/protocol_runner.cpp'),
                str(ROOT/'firmware/src/core.cpp'),str(ROOT/'firmware/src/protocol.cpp'),'-o',str(binary)],check=True)
            cls.binaries[demo]=binary
    @classmethod
    def tearDownClass(cls): cls.directory.cleanup()
    def run_protocol(self,demo,lines):
        run=subprocess.run([str(self.binaries[demo])],input='\n'.join(lines)+'\n',text=True,capture_output=True,check=True)
        return [json.loads(line) for line in run.stdout.splitlines()]
    def test_real_export_upload_feedback_manual_stop(self):
        profile=converter.convert(converter.load_document(FIXTURE),confirm_charge=True)
        lines=converter.commands(profile,session=4242,first_seq=1,deadline=6000)
        seq=len(lines)+1
        commands=lines+['STATUS',f'R1 4242 {seq} 6000 ARM',f'R1 4242 {seq+1} 6000 START','@tick 1000','STATUS',
            f'R1 4242 {seq+2} 6000 MANUAL',f'R1 4242 {seq+3} 6000 OUTPUT 25','@tick 500','STATUS',
            f'R1 4242 {seq+4} 6000 STOP','STATUS',f'R1 4242 {seq+5} 6000 START','STATUS']
        output=self.run_protocol(1,commands)
        self.assertTrue(all(x['ok'] for x in output[:len(lines)]))
        status=[x for x in output if 'curve_hash' in x]
        self.assertEqual(status[0]['curve_hash'],profile['hash'])
        self.assertEqual(status[0]['state'].lower(),'ready')
        self.assertEqual(status[1]['state'].lower(),'running')
        self.assertGreater(status[1]['requested_pct'],0)
        self.assertGreater(status[1]['bt'],25)
        self.assertEqual(status[2]['state'].lower(),'manual')
        self.assertEqual(status[2]['requested_pct'],25)
        self.assertEqual(status[3]['state'].lower(),'idle')
        self.assertEqual(status[3]['requested_pct'],0)
        self.assertEqual(status[4]['state'].lower(),'idle')
        self.assertTrue(all(x['physical_enabled'] is False for x in status))
        self.assertTrue(all(x['physical_actual_pct'] is None for x in status))
    def test_same_export_cannot_control_locked_build(self):
        profile=converter.convert(converter.load_document(FIXTURE),confirm_charge=True)
        lines=converter.commands(profile,session=4242,first_seq=1,deadline=6000)
        output=self.run_protocol(0,lines+['STATUS'])
        self.assertTrue(all(not x['ok'] for x in output[:-1]))
        self.assertEqual(output[-1]['state'].lower(),'locked')
        self.assertIsNone(output[-1]['bt'])
        self.assertEqual(output[-1]['requested_pct'],0)
        self.assertIs(output[-1]['physical_enabled'],False)

if __name__=='__main__': unittest.main()
