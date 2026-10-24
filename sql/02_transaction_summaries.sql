-- =====================================================================
-- 02  Transaction summaries
-- One row per basket = one invoice. All queries read the cleaned view.
-- =====================================================================

-- name: overall_kpis
WITH baskets AS (
    SELECT invoice_no,
           COUNT(DISTINCT product_id) AS distinct_items,
           SUM(quantity)              AS units,
           SUM(line_total)            AS basket_value
    FROM transactions
    GROUP BY invoice_no
)
SELECT COUNT(*)                                        AS transactions,
       (SELECT COUNT(DISTINCT customer_id) FROM transactions) AS customers,
       (SELECT COUNT(DISTINCT product_id) FROM transactions)  AS products,
       ROUND(SUM(basket_value), 2)                     AS revenue,
       ROUND(AVG(basket_value), 2)                     AS avg_order_value,
       ROUND(AVG(distinct_items), 2)                   AS avg_items_per_basket,
       ROUND(AVG(units), 2)                            AS avg_units_per_basket,
       ROUND(100.0 * SUM(distinct_items = 1) / COUNT(*), 1) AS pct_single_item_baskets
FROM baskets;

-- name: basket_size_distribution
WITH baskets AS (
    SELECT invoice_no, COUNT(DISTINCT product_id) AS distinct_items, SUM(line_total) AS basket_value
    FROM transactions GROUP BY invoice_no
)
SELECT distinct_items,
       COUNT(*)                                   AS transactions,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_transactions,
       ROUND(AVG(basket_value), 2)                AS avg_basket_value
FROM baskets
GROUP BY distinct_items
ORDER BY distinct_items;

-- name: monthly_summary
SELECT STRFTIME('%Y-%m', invoice_date)            AS month,
       COUNT(DISTINCT invoice_no)                 AS transactions,
       ROUND(SUM(line_total), 2)                  AS revenue,
       ROUND(SUM(line_total) / COUNT(DISTINCT invoice_no), 2) AS avg_order_value
FROM transactions
GROUP BY month
ORDER BY month;

-- name: weekday_hour_summary
SELECT CASE CAST(STRFTIME('%w', invoice_datetime) AS INTEGER)
            WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
            WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END AS weekday,
       CAST(STRFTIME('%w', invoice_datetime) AS INTEGER) AS weekday_num,
       CAST(STRFTIME('%H', invoice_datetime) AS INTEGER) AS hour,
       COUNT(DISTINCT invoice_no)                 AS transactions
FROM transactions
GROUP BY weekday_num, hour
ORDER BY weekday_num, hour;

-- name: store_summary
SELECT store_id,
       COUNT(DISTINCT invoice_no)                 AS transactions,
       ROUND(SUM(line_total), 2)                  AS revenue,
       ROUND(SUM(line_total) / COUNT(DISTINCT invoice_no), 2) AS avg_order_value,
       ROUND(1.0 * COUNT(*) / COUNT(DISTINCT invoice_no), 2)  AS avg_items_per_basket
FROM transactions
GROUP BY store_id
ORDER BY revenue DESC;

-- name: customer_segments
-- Simple frequency segmentation of identified customers.
WITH per_customer AS (
    SELECT customer_id, COUNT(DISTINCT invoice_no) AS visits, SUM(line_total) AS spend
    FROM transactions
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
)
SELECT CASE WHEN visits >= 6 THEN '6+ visits'
            WHEN visits >= 4 THEN '4-5 visits'
            WHEN visits >= 2 THEN '2-3 visits'
            ELSE '1 visit' END                    AS segment,
       COUNT(*)                                   AS customers,
       ROUND(AVG(visits), 2)                      AS avg_visits,
       ROUND(AVG(spend), 2)                       AS avg_spend
FROM per_customer
GROUP BY segment
ORDER BY MIN(visits);
