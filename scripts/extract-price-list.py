"""Extract the supplier price list (Price_List.xlsx) into src/data/supplier-price-list.json.

Reads only the columns the storefront needs: product code (A), product name (B),
specification (C), the "<200 Boxes (Total Order)" USD price (H) and the free-text
note column (I). Merged cells in A:C are filled down so every row carries its own
identity. Standard library only; the workbook is never modified.

Usage:
    python3 scripts/extract-price-list.py [source.xlsx] [target.json]
"""

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

DEFAULT_SOURCE = Path.home() / "Desktop" / "Price_List.xlsx"
DEFAULT_TARGET = Path(__file__).resolve().parent.parent / "src/data/supplier-price-list.json"
PRICE_COLUMN = "H"
EXPECTED_HEADERS = {
    "A": "Product Code",
    "B": "Product Name",
    "C": "Specification",
    "H": "<200 Boxes (Total Order)",
}
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def column_of(address: str) -> str:
    return re.match(r"[A-Z]+", address).group(0)


def row_of(address: str) -> int:
    return int(re.search(r"\d+$", address).group(0))


def cell_text(cell, shared):
    value = cell.find("s:v", NS)
    raw = value.text if value is not None else ""
    if cell.get("t") == "s" and raw:
        return "".join(shared[int(raw)].itertext())
    if cell.get("t") == "inlineStr":
        return "".join(cell.find("s:is", NS).itertext())
    return raw or ""


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_TARGET

    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            shared = ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    cells: dict[str, str] = {}
    for cell in sheet.findall("s:sheetData/s:row/s:c", NS):
        address = cell.get("r", "")
        if column_of(address) not in ("A", "B", "C", "H", "I"):
            continue
        cells[address] = cell_text(cell, shared).strip()

    # Fill merged ranges down/right from their anchor cell so continuation rows
    # (e.g. TR10 under the merged "Tirzepatide" name cell) carry the name.
    for merged in sheet.findall("s:mergeCells/s:mergeCell", NS):
        first, last = merged.get("ref", "").split(":")
        first_col, last_col = column_of(first), column_of(last)
        anchor = cells.get(first, "")
        for column in (chr(c) for c in range(ord(first_col), ord(last_col) + 1)):
            if column not in ("A", "B", "C"):
                continue
            for row in range(row_of(first), row_of(last) + 1):
                cells[f"{column}{row}"] = anchor

    for column, expected in EXPECTED_HEADERS.items():
        actual = " ".join(cells.get(f"{column}1", "").split())
        if actual != expected:
            raise SystemExit(f"Unexpected header in {column}1: {actual!r} (expected {expected!r})")

    products = []
    notes = []
    for row in sheet.findall("s:sheetData/s:row", NS):
        index = int(row.get("r"))
        note = cells.get(f"I{index}", "")
        if note:
            notes.append({"row": index, "text": note})
        if index == 1:
            continue
        code, name, specification = (cells.get(f"{c}{index}", "") for c in "ABC")
        price_raw = cells.get(f"H{index}", "")
        if not any([code, name, specification, price_raw]):
            continue
        if not code or not specification or not price_raw:
            raise SystemExit(f"Incomplete product row {index}: code={code!r} spec={specification!r} price={price_raw!r}")
        price = float(price_raw)
        if not price.is_integer() or price <= 0:
            raise SystemExit(f"Row {index}: column H price {price_raw!r} is not a positive whole USD amount")
        products.append(
            {
                "row": index,
                "code": code,
                "name": name,
                "specification": " ".join(specification.split()),
                "priceUsd": int(price),
            }
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "source": source.name,
                "sheet": "Sheet1",
                "columns": "A:C + H (+ I notes)",
                "priceColumn": PRICE_COLUMN,
                "priceTier": EXPECTED_HEADERS["H"],
                "currency": "USD",
                "priceUnit": "box",
                "notes": notes,
                "products": products,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(products)} product rows (column {PRICE_COLUMN} pricing) into {target}")


if __name__ == "__main__":
    main()
