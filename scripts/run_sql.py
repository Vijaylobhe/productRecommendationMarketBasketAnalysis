"""Load the raw CSVs into SQLite and run every named query in sql/.

Each query in a .sql file starts with a `-- name: <query_name>` comment.
Statements that return rows are saved to outputs/sql_results/<query_name>.csv.

Usage:  python scripts/run_sql.py
"""
import re
import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "retail.db"
OUT_DIR = ROOT / "outputs" / "sql_results"


def named_queries(sql_text):
    """Split a .sql file into (name, sql) blocks on `-- name:` markers."""
    parts = re.split(r"^--\s*name:\s*(\w+)\s*$", sql_text, flags=re.MULTILINE)
    return [(parts[i], parts[i + 1].strip()) for i in range(1, len(parts), 2)]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.unlink(missing_ok=True)
    con = sqlite3.connect(DB_PATH)

    sql_files = sorted((ROOT / "sql").glob("*.sql"))
    # schema first, then load data, then everything else
    for name, sql in named_queries(sql_files[0].read_text()):
        if name.startswith("create_"):
            con.executescript(sql)
    pd.read_csv(ROOT / "data" / "products.csv").to_sql("products", con, if_exists="append", index=False)
    pd.read_csv(ROOT / "data" / "raw" / "transactions_raw.csv", dtype={"customer_id": str}) \
        .to_sql("transactions_raw", con, if_exists="append", index=False)

    for path in sql_files:
        for name, sql in named_queries(path.read_text()):
            if name.startswith("create_"):
                continue
            result = pd.read_sql_query(sql, con)
            result.to_csv(OUT_DIR / f"{name}.csv", index=False)
            print(f"{path.name:<28} {name:<30} {len(result):>5} rows")
    con.close()


if __name__ == "__main__":
    main()
