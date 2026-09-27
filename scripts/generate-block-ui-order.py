"""共通UI定義から最終配置表を生成・検査する。Python標準ライブラリのみ使用。"""
import csv
import io
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'docs/developer/ui'
with (FOLDER / 'BLOCK_UI_DEFINITION.tsv').open(encoding='utf-8', newline='') as stream:
    definitions = list(csv.DictReader(stream, delimiter='\t'))
assert len({(r['レベル'], r['共通ID']) for r in definitions}) == len(definitions)
areas = [('上部', 'ブロック上部（左→右）'), ('展開メニュー', 'その他メニュー（上→下）'),
         ('コピー▽', 'コピーのサブメニュー'), ('表示内容コンボ', '表示内容の選択肢'),
         ('列表示／スライサー', '列表示／スライサーパネル'), ('表の列ヘッダー', '表の列ヘッダー'),
         ('表フッター', '表フッター'), ('表の右クリック', '表の右クリックメニュー')]
result = []
for level in ('1', '2', '3'):
    groups = {}
    for row in definitions:
        if row['レベル'] != level:
            continue
        placement = row['Desktop修正案の配置']
        area = next((i for i, (prefix, _) in enumerate(areas, 1) if placement.startswith(prefix)), None)
        assert area is not None, placement
        groups.setdefault(area, []).append(row)
    for area, rows in sorted(groups.items()):
        previous = None
        order = 0
        for row in sorted(rows, key=lambda r: Decimal(r['共通順序番号'])):
            group = row['グループ']
            # 区切り線は表示対象を絞った後にUIが判定。ここでは条件付き境界を示す。
            boundary = previous is not None and group != previous and (group == 'コピー' or previous in ('コピー', '表示'))
            order += 1
            identifier = row['共通ID']
            shape = row['UI種別']
            if identifier in ('copy', 'view') and level != '2':
                shape = 'グループ（独立ボタンではない）'
            hosts = 'Desktopのみ' if identifier in ('ai', 'run') else 'Desktop・HTML・PHP（対応機能のみ）'
            result.append([f'{level}-{area:02d}-{order:02d}', level, areas[area - 1][1], order,
                           row['表示名'], shape, '直前に区切り（隣接する両グループが非空の場合のみ）' if boundary else '',
                           row['表示する種類'], hosts, row['表示条件'], identifier])
            previous = group
buffer = io.StringIO(newline='')
writer = csv.writer(buffer, delimiter='\t', lineterminator='\n')
writer.writerow(['最終配置キー', 'レベル', '配置場所', '場所内の順番', '表示名', '表示形態', '区切り条件', '表示する種類', '対象アプリ', '表示条件', '共通ID'])
writer.writerows(result)
output = FOLDER / 'BLOCK_UI_FINAL_ORDER.tsv'
if '--check' in sys.argv:
    assert output.read_text(encoding='utf-8') == buffer.getvalue(), '最終配置表が未更新です'
else:
    output.write_text(buffer.getvalue(), encoding='utf-8')
assert len(result) == len(definitions)
print(f'ブロックUI: {len(result)}定義、配置順と共通IDを検証しました')
