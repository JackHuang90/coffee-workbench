#!/usr/bin/env python3
"""Offline, no-I/O-to-device converter for Roast Studio exports.

Only fixed validated numeric targets are emitted. Metadata is never executable.
The output is not a physical hardware profile and cannot unlock either firmware.
"""
import argparse
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_POINTS = 1024
MAX_DURATION_MS = 1_800_000
MAX_GAP_MS = 5_000
U32_MAX = 0xFFFFFFFF


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'JSON: duplicate key {key!r}')
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f'JSON: non-finite number {value} is not accepted')


def load_document(path):
    """Bound bytes before JSON parsing; disallow ambiguous keys and NaN/Infinity."""
    with Path(path).open('rb') as handle:
        raw = handle.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('file exceeds 2 MiB limit')
    try:
        return json.loads(raw.decode('utf-8-sig'), parse_float=Decimal,
                          parse_constant=_reject_constant, object_pairs_hook=_object_pairs)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError(f'invalid UTF-8 JSON: {exc}') from exc


def select_curve(document, curve_id=None):
    if not isinstance(document, dict):
        raise ValueError('export must be an object')
    if document.get('format') == 'coffee-roasting-library':
        if document.get('version') != 1 or isinstance(document.get('version'), bool):
            raise ValueError('unsupported library export version')
        curves = document.get('curves')
        if not isinstance(curves, list) or not curves:
            raise ValueError('library has no curves')
        if curve_id is None:
            raise ValueError('select one curve explicitly with --curve-id for library exports')
        selected = [curve for curve in curves if isinstance(curve, dict) and curve.get('id') == curve_id]
        if len(selected) != 1:
            raise ValueError('selected curve ID must match exactly one library curve')
        return selected[0]
    if curve_id is not None and document.get('id') != curve_id:
        raise ValueError('--curve-id does not match the single exported curve')
    return document


def _number(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError(f'{path}: finite numeric value required (no strings/null/booleans)')
    number = Decimal(str(value))
    if not number.is_finite():
        raise ValueError(f'{path}: finite numeric value required')
    return number


def _time_ms(value, path):
    seconds = _number(value, path)
    if seconds < 0 or seconds > 86400:
        raise ValueError(f'{path}: seconds outside 0..86400')
    ms = seconds * 1000
    if ms != ms.to_integral_value():
        raise ValueError(f'{path}: sub-millisecond times are not representable; export millisecond precision')
    return int(ms)


def _origin_ms(value):
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError('--origin must be finite seconds') from exc
    return _time_ms(number, 'origin')


def hash_points(points):
    """Protocol FNV-1a of uint32-LE milliseconds and int16-LE deci-C."""
    value = 2166136261
    for point in points:
        for byte in struct.pack('<Ih', point['ms'], point['bt_deci_c']):
            value = ((value ^ byte) * 16777619) & U32_MAX
    return value


def convert(document, *, origin=None, confirm_charge=False, curve_id=None):
    curve = select_curve(document, curve_id)
    schema = curve.get('schemaVersion')
    if isinstance(schema, bool) or schema not in (1, 2):
        raise ValueError('schemaVersion must be 1 or 2')
    source_id = curve.get('id')
    if not isinstance(source_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', source_id):
        raise ValueError('curve id is not a valid Roast Studio identifier')
    source = curve.get('source', 'legacy_unspecified')
    if schema == 2 and source not in ('legacy', 'simulation', 'imported', 'example'):
        raise ValueError('schema 2 must identify its data source')
    samples = curve.get('samples')
    if not isinstance(samples, list) or not 2 <= len(samples) <= 15000:
        raise ValueError('samples must contain 2..15000 entries before selecting origin')
    markers = curve.get('markers')
    if not isinstance(markers, list):
        raise ValueError('markers must be an array')
    if origin is not None and confirm_charge:
        raise ValueError('choose either explicit --origin or --confirm-charge, not both')
    if origin is None:
        if not confirm_charge:
            raise ValueError('confirm CHARGE with --confirm-charge or provide explicit --origin seconds')
        charges = [m for m in markers if isinstance(m, dict) and m.get('kind') == 'CHARGE']
        if len(charges) != 1:
            raise ValueError('exactly one CHARGE marker is required; otherwise specify explicit --origin')
        origin_ms = _time_ms(charges[0].get('t'), 'CHARGE.t')
        origin_source = 'confirmed_charge'
    else:
        origin_ms = _origin_ms(origin)
        origin_source = 'explicit_seconds'

    parsed = []
    previous = None
    for index, sample in enumerate(samples):
        if not isinstance(sample, dict):
            raise ValueError(f'samples[{index}]: object required')
        ms = _time_ms(sample.get('t'), f'samples[{index}].t')
        bt = _number(sample.get('bt'), f'samples[{index}].bt')
        if bt < -20 or bt > 280:
            raise ValueError(f'samples[{index}].bt: target outside firmware -20..280 Celsius range')
        if previous is not None:
            if ms <= previous:
                raise ValueError(f'samples[{index}].t: times must strictly increase')
            if ms - previous > MAX_GAP_MS:
                raise ValueError(f'samples[{index}].t: gap exceeds 5 seconds; missing target data are not interpolated')
        previous = ms
        parsed.append({'ms': ms, 'bt_deci_c': int((bt * 10).to_integral_value(rounding=ROUND_HALF_UP))})
    if not any(point['ms'] == origin_ms for point in parsed):
        raise ValueError('origin must exactly match an existing sample; no synthetic origin temperature is inserted')
    points = [{'ms': point['ms'] - origin_ms, 'bt_deci_c': point['bt_deci_c']}
              for point in parsed if point['ms'] >= origin_ms]
    if not 2 <= len(points) <= MAX_POINTS:
        raise ValueError('selected target requires 2..1024 points; shorten the curve or explicitly resample offline, preserving <=5 s gaps')
    if points[-1]['ms'] > MAX_DURATION_MS:
        raise ValueError('selected target exceeds 30-minute duration limit')
    digest = hash_points(points)
    safe_id = source_id if re.fullmatch(r'[A-Za-z0-9_-]{1,24}', source_id) else f'curve-{hashlib.sha256(source_id.encode()).hexdigest()[:16]}'
    ignored = sorted(set(curve) - {'schemaVersion', 'id', 'samples', 'markers', 'source'})
    ignored.extend(['et', 'non-CHARGE markers', 'marker metadata', 'sample fields other than t/bt'])
    return {
        'format': 'roast-firmware-target', 'protocol_version': 1,
        'mode': 'VIRTUAL_DEMO_ONLY', 'physical_enabled': False,
        'source_schema': int(schema), 'source_label': source,
        'source_id': source_id, 'id': safe_id,
        'origin_seconds': str(Decimal(origin_ms) / 1000), 'origin_source': origin_source,
        'count': len(points), 'duration_ms': points[-1]['ms'], 'hash': digest,
        'hash_algorithm': 'FNV-1a-32 over uint32_le(ms), int16_le(bt_deci_c)',
        'temperature_quantization': 'nearest 0.1 Celsius; ties away from zero',
        'ignored_fields': ignored,
        'warning': 'Inert target data only. No device I/O, ARM, START, tuning or hardware authorization. Demo plant is not a real roaster.',
        'points': points,
    }


def _u32(value, name, *, nonzero=False):
    if isinstance(value, bool) or not isinstance(value, int) or value < int(nonzero) or value > U32_MAX:
        raise ValueError(f'{name} must be an unsigned 32-bit integer' + (' greater than zero' if nonzero else ''))
    return value


def commands(profile, *, session, first_seq, deadline):
    _u32(session, 'session', nonzero=True)
    _u32(first_seq, 'first_seq', nonzero=True)
    _u32(deadline, 'deadline')
    count = len(profile['points']) + 2
    if first_seq + count - 1 > U32_MAX:
        raise ValueError('sequence numbers would overflow; obtain a new session instead')
    bodies = [f"BEGIN {profile['id']} {profile['count']} {profile['hash']}"]
    bodies += [f"POINT {index} {point['ms']} {point['bt_deci_c']}" for index, point in enumerate(profile['points'])]
    bodies.append('COMMIT')
    result = [f'R1 {session} {first_seq + i} {deadline} {body}' for i, body in enumerate(bodies)]
    if any(len(line.encode('ascii')) > 255 for line in result):
        raise ValueError('internal error: protocol line exceeds 255 bytes')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--curve-id', help='required selection for a library export')
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument('--confirm-charge', action='store_true', help='explicitly confirm existing CHARGE marker as origin')
    origin.add_argument('--origin', help='explicit origin in seconds, exactly matching a sample')
    parser.add_argument('--emit', choices=('profile', 'commands'), default='profile')
    parser.add_argument('--session', type=int)
    parser.add_argument('--first-seq', type=int)
    parser.add_argument('--deadline', type=int, help='device millis deadline; NOT host wall-clock time')
    args = parser.parse_args(argv)
    try:
        profile = convert(load_document(args.input), origin=args.origin,
                          confirm_charge=args.confirm_charge, curve_id=args.curve_id)
        if args.emit == 'commands':
            if any(value is None for value in (args.session, args.first_seq, args.deadline)):
                raise ValueError('--emit commands requires --session, --first-seq and --deadline from current device status')
            print('WARNING: offline transcript only; deadlines expire within 5 s. Check every ACK; no ARM/START is emitted. A live client must refresh envelope deadlines. No device I/O performed.', file=sys.stderr)
            print('Ignored fields: ' + ', '.join(profile['ignored_fields']), file=sys.stderr)
            print('\n'.join(commands(profile, session=args.session, first_seq=args.first_seq, deadline=args.deadline)))
        else:
            print(json.dumps(profile, indent=2, ensure_ascii=False))
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
