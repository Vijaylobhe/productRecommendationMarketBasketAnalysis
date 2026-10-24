-- =====================================================================
-- 01  Schema and cleaning view (SQLite)
-- The raw CSVs are loaded into `products` and `transactions_raw` by
-- scripts/run_sql.py. Every analysis query reads from the `transactions`
-- view below, which applies the same cleaning rules as the notebook.
-- =====================================================================

-- name: create_products
CREATE TABLE IF NOT EXISTS products (
    product_id   TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    category     TEXT NOT NULL,
    unit_price   REAL NOT NULL
);

-- name: create_transactions_raw
CREATE TABLE IF NOT EXISTS transactions_raw (
    invoice_no       TEXT,
    invoice_datetime TEXT,
    customer_id      TEXT,
    store_id         TEXT,
    product_id       TEXT,
    product_name     TEXT,
    category         TEXT,
    quantity         INTEGER,
    unit_price       REAL
);

-- name: create_transactions_view
-- Cleaning rules:
--   1. drop cancelled invoices (invoice_no starts with 'C')
--   2. drop returns / non-positive quantities
--   3. drop zero-price POS test rows
--   4. collapse exact duplicate line items (scanner double-reads)
--   5. take the canonical product name from the product master
DROP VIEW IF EXISTS transactions;
CREATE VIEW transactions AS
SELECT DISTINCT
    r.invoice_no,
    r.invoice_datetime,
    DATE(r.invoice_datetime)              AS invoice_date,
    NULLIF(TRIM(r.customer_id), '')       AS customer_id,
    r.store_id,
    r.product_id,
    p.product_name,
    p.category,
    r.quantity,
    r.unit_price,
    ROUND(r.quantity * r.unit_price, 2)   AS line_total
FROM transactions_raw r
JOIN products p ON p.product_id = r.product_id
WHERE r.invoice_no NOT LIKE 'C%'
  AND r.quantity > 0
  AND r.unit_price > 0;

-- name: data_quality_report
SELECT 'raw line items'                         AS check_name, COUNT(*) AS row_count FROM transactions_raw
UNION ALL SELECT 'cancelled invoice lines',     COUNT(*) FROM transactions_raw WHERE invoice_no LIKE 'C%'
UNION ALL SELECT 'returns (quantity <= 0, not cancelled)', COUNT(*) FROM transactions_raw WHERE quantity <= 0 AND invoice_no NOT LIKE 'C%'
UNION ALL SELECT 'zero-price test rows',        COUNT(*) FROM transactions_raw WHERE unit_price = 0
UNION ALL SELECT 'missing product_name',        COUNT(*) FROM transactions_raw WHERE product_name IS NULL OR TRIM(product_name) = ''
UNION ALL SELECT 'non-canonical product_name',  COUNT(*) FROM transactions_raw r JOIN products p USING (product_id)
                                                 WHERE r.product_name IS NOT NULL AND r.product_name <> p.product_name
UNION ALL SELECT 'exact duplicate lines',       COUNT(*) - (SELECT COUNT(*) FROM (SELECT DISTINCT * FROM transactions_raw)) FROM transactions_raw
UNION ALL SELECT 'guest checkouts (no customer_id)', COUNT(DISTINCT invoice_no) FROM transactions_raw WHERE customer_id IS NULL OR TRIM(customer_id) = ''
UNION ALL SELECT 'clean line items',            COUNT(*) FROM transactions;
