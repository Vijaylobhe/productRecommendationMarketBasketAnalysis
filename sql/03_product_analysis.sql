-- =====================================================================
-- 03  Product analysis
-- Product and category performance, then pair-level support, confidence
-- and lift computed directly in SQL as a cross-check on the mlxtend output.
-- =====================================================================

-- name: product_performance
WITH n AS (SELECT COUNT(DISTINCT invoice_no) AS total FROM transactions)
SELECT t.product_id,
       t.product_name,
       t.category,
       COUNT(DISTINCT t.invoice_no)                         AS transactions,
       ROUND(1.0 * COUNT(DISTINCT t.invoice_no) / n.total, 4) AS support,
       SUM(t.quantity)                                      AS units_sold,
       ROUND(SUM(t.line_total), 2)                          AS revenue,
       RANK() OVER (ORDER BY COUNT(DISTINCT t.invoice_no) DESC) AS popularity_rank
FROM transactions t CROSS JOIN n
GROUP BY t.product_id, t.product_name, t.category, n.total
ORDER BY transactions DESC;

-- name: category_performance
WITH n AS (SELECT COUNT(DISTINCT invoice_no) AS total FROM transactions)
SELECT t.category,
       COUNT(DISTINCT t.product_id)                         AS products,
       COUNT(DISTINCT t.invoice_no)                         AS transactions,
       ROUND(100.0 * COUNT(DISTINCT t.invoice_no) / n.total, 1) AS pct_of_baskets,
       ROUND(SUM(t.line_total), 2)                          AS revenue,
       ROUND(100.0 * SUM(t.line_total) / (SELECT SUM(line_total) FROM transactions), 1) AS pct_of_revenue
FROM transactions t CROSS JOIN n
GROUP BY t.category, n.total
ORDER BY revenue DESC;

-- name: single_item_basket_products
-- Products most often bought on their own: candidates for cross-sell prompts.
WITH sizes AS (
    SELECT invoice_no, COUNT(DISTINCT product_id) AS k FROM transactions GROUP BY invoice_no
)
SELECT t.product_name,
       COUNT(DISTINCT t.invoice_no)                                       AS transactions,
       SUM(s.k = 1)                                                       AS solo_transactions,
       ROUND(100.0 * SUM(s.k = 1) / COUNT(DISTINCT t.invoice_no), 1)      AS pct_bought_alone
FROM transactions t JOIN sizes s USING (invoice_no)
GROUP BY t.product_name
ORDER BY pct_bought_alone DESC;

-- name: product_pair_rules
-- Every ordered pair A -> B seen together in at least 1% of baskets.
--   support(A,B)   = baskets with A and B / all baskets
--   confidence     = support(A,B) / support(A)
--   lift           = confidence / support(B)
WITH basket_items AS (
    SELECT DISTINCT invoice_no, product_name FROM transactions
),
n AS (SELECT COUNT(DISTINCT invoice_no) AS total FROM basket_items),
item_counts AS (
    SELECT product_name, COUNT(*) AS cnt FROM basket_items GROUP BY product_name
),
pair_counts AS (
    SELECT a.product_name AS antecedent, b.product_name AS consequent, COUNT(*) AS cnt
    FROM basket_items a
    JOIN basket_items b ON a.invoice_no = b.invoice_no AND a.product_name <> b.product_name
    GROUP BY a.product_name, b.product_name
)
SELECT pc.antecedent,
       pc.consequent,
       pc.cnt                                                     AS together,
       ROUND(1.0 * pc.cnt / n.total, 4)                           AS support,
       ROUND(1.0 * pc.cnt / ia.cnt, 4)                            AS confidence,
       ROUND((1.0 * pc.cnt / ia.cnt) / (1.0 * ib.cnt / n.total), 3) AS lift
FROM pair_counts pc
JOIN item_counts ia ON ia.product_name = pc.antecedent
JOIN item_counts ib ON ib.product_name = pc.consequent
CROSS JOIN n
WHERE 1.0 * pc.cnt / n.total >= 0.01
ORDER BY lift DESC, confidence DESC;

-- name: category_pairs
-- Which categories share a basket more often than chance would predict.
WITH basket_cats AS (
    SELECT DISTINCT invoice_no, category FROM transactions
),
n AS (SELECT COUNT(DISTINCT invoice_no) AS total FROM basket_cats),
cat_counts AS (SELECT category, COUNT(*) AS cnt FROM basket_cats GROUP BY category)
SELECT a.category AS category_a,
       b.category AS category_b,
       COUNT(*)   AS together,
       ROUND(1.0 * COUNT(*) / n.total, 4) AS support,
       ROUND((1.0 * COUNT(*) / n.total) / ((1.0 * ca.cnt / n.total) * (1.0 * cb.cnt / n.total)), 3) AS lift
FROM basket_cats a
JOIN basket_cats b ON a.invoice_no = b.invoice_no AND a.category < b.category
JOIN cat_counts ca ON ca.category = a.category
JOIN cat_counts cb ON cb.category = b.category
CROSS JOIN n
GROUP BY a.category, b.category, ca.cnt, cb.cnt, n.total
ORDER BY lift DESC;
