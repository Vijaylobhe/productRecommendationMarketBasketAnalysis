"""Generate a synthetic grocery transaction dataset for market basket analysis.

The store ("FreshCart", fictional) sells 40 products across 9 categories.
Baskets are built from shopping "missions" (pasta night, breakfast, taco night,
...) plus random top-up items, so real co-purchase structure exists for the
Apriori algorithm to recover. A small amount of realistic dirt is injected
(duplicate rows, cancelled invoices, returns, inconsistent casing, missing
values) so the notebook has genuine cleaning work to do.

Usage:  python scripts/generate_data.py
Writes: data/raw/transactions_raw.csv, data/products.csv
"""
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
N_INVOICES = 8000
N_CUSTOMERS = 2200
STORES = ["S01-Downtown", "S02-Riverside", "S03-Northgate"]
START, END = "2025-01-01", "2025-12-31"

ROOT = Path(__file__).resolve().parents[1]

# product_id, name, category, unit_price, base popularity weight
PRODUCTS = [
    ("P001", "Whole Milk", "Dairy", 1.49, 9),
    ("P002", "Butter", "Dairy", 3.29, 4),
    ("P003", "Cheddar Cheese", "Dairy", 4.99, 4),
    ("P004", "Greek Yogurt", "Dairy", 1.19, 6),
    ("P005", "Free-Range Eggs", "Dairy", 3.79, 6),
    ("P006", "Parmesan", "Dairy", 5.49, 2),
    ("P007", "Sourdough Bread", "Bakery", 3.99, 7),
    ("P008", "Burger Buns", "Bakery", 2.49, 2),
    ("P009", "Croissants", "Bakery", 3.49, 3),
    ("P010", "Flour Tortillas", "Bakery", 2.29, 2),
    ("P011", "Bananas", "Produce", 1.29, 10),
    ("P012", "Avocados", "Produce", 1.99, 4),
    ("P013", "Tomatoes", "Produce", 2.19, 6),
    ("P014", "Onions", "Produce", 1.09, 5),
    ("P015", "Lettuce", "Produce", 1.79, 4),
    ("P016", "Lemons", "Produce", 0.69, 3),
    ("P017", "Strawberries", "Produce", 3.99, 4),
    ("P018", "Spaghetti", "Pantry", 1.59, 4),
    ("P019", "Pasta Sauce", "Pantry", 2.99, 3),
    ("P020", "Breakfast Cereal", "Pantry", 3.89, 5),
    ("P021", "Strawberry Jam", "Pantry", 2.79, 2),
    ("P022", "Peanut Butter", "Pantry", 3.49, 3),
    ("P023", "Honey", "Pantry", 4.49, 2),
    ("P024", "Olive Oil", "Pantry", 7.99, 2),
    ("P025", "Ground Coffee", "Beverages", 6.99, 5),
    ("P026", "Green Tea", "Beverages", 3.29, 3),
    ("P027", "Orange Juice", "Beverages", 3.49, 5),
    ("P028", "Sparkling Water", "Beverages", 0.99, 6),
    ("P029", "Craft Beer 6-pack", "Alcohol", 9.99, 3),
    ("P030", "Red Wine", "Alcohol", 11.99, 3),
    ("P031", "Tortilla Chips", "Snacks", 2.99, 4),
    ("P032", "Salsa", "Snacks", 3.19, 2),
    ("P033", "Dark Chocolate", "Snacks", 2.49, 4),
    ("P034", "Ground Beef", "Meat & Seafood", 6.49, 3),
    ("P035", "Chicken Breast", "Meat & Seafood", 7.49, 5),
    ("P036", "Smoked Bacon", "Meat & Seafood", 4.99, 3),
    ("P037", "Salmon Fillet", "Meat & Seafood", 9.99, 2),
    ("P038", "Diapers", "Baby & Household", 12.99, 2),
    ("P039", "Baby Wipes", "Baby & Household", 3.99, 2),
    ("P040", "Paper Towels", "Baby & Household", 5.49, 3),
]

# Shopping missions: (weight, [(product_name, inclusion probability), ...])
MISSIONS = [
    (10, [("Spaghetti", 0.95), ("Pasta Sauce", 0.80), ("Parmesan", 0.50), ("Onions", 0.30), ("Red Wine", 0.20)]),
    (14, [("Sourdough Bread", 0.90), ("Butter", 0.60), ("Strawberry Jam", 0.35), ("Free-Range Eggs", 0.40)]),
    (12, [("Breakfast Cereal", 0.95), ("Whole Milk", 0.85), ("Bananas", 0.45)]),
    (10, [("Ground Coffee", 0.95), ("Whole Milk", 0.55), ("Croissants", 0.35)]),
    (8, [("Flour Tortillas", 0.90), ("Salsa", 0.70), ("Avocados", 0.65), ("Ground Beef", 0.40), ("Tortilla Chips", 0.35)]),
    (9, [("Tortilla Chips", 0.90), ("Salsa", 0.55), ("Craft Beer 6-pack", 0.55)]),
    (7, [("Burger Buns", 0.95), ("Ground Beef", 0.85), ("Cheddar Cheese", 0.60), ("Lettuce", 0.45), ("Tomatoes", 0.45)]),
    (6, [("Diapers", 0.95), ("Baby Wipes", 0.80), ("Craft Beer 6-pack", 0.20)]),
    (6, [("Red Wine", 0.90), ("Cheddar Cheese", 0.45), ("Dark Chocolate", 0.45)]),
    (9, [("Free-Range Eggs", 0.90), ("Smoked Bacon", 0.70), ("Sourdough Bread", 0.35), ("Orange Juice", 0.35)]),
    (6, [("Green Tea", 0.90), ("Honey", 0.55), ("Lemons", 0.45)]),
    (8, [("Salmon Fillet", 0.85), ("Lemons", 0.60), ("Olive Oil", 0.30), ("Lettuce", 0.35)]),
    (9, [("Chicken Breast", 0.90), ("Lettuce", 0.50), ("Tomatoes", 0.50), ("Olive Oil", 0.25)]),
    (7, [("Greek Yogurt", 0.90), ("Strawberries", 0.60), ("Honey", 0.30)]),
    (5, [("Peanut Butter", 0.90), ("Strawberry Jam", 0.50), ("Sourdough Bread", 0.55), ("Bananas", 0.30)]),
]


def build_basket(rng, names, popularity, mission_cdf):
    basket = set()
    n_missions = rng.choice([0, 1, 1, 1, 2, 2, 3])
    for _ in range(n_missions):
        _, items = MISSIONS[np.searchsorted(mission_cdf, rng.random())]
        for name, p in items:
            if rng.random() < p:
                basket.add(name)
    # top-up items, drawn by general popularity
    n_extra = rng.poisson(1.6) + (1 if not basket else 0)
    if n_extra:
        basket.update(rng.choice(names, size=n_extra, replace=True, p=popularity))
    return sorted(basket)


def main():
    rng = np.random.default_rng(SEED)
    products = pd.DataFrame(PRODUCTS, columns=["product_id", "product_name", "category", "unit_price", "weight"])
    names = products["product_name"].to_numpy()
    popularity = (products["weight"] / products["weight"].sum()).to_numpy()
    by_name = products.set_index("product_name")

    mission_w = np.array([w for w, _ in MISSIONS], dtype=float)
    mission_cdf = np.cumsum(mission_w / mission_w.sum())

    days = pd.date_range(START, END, freq="D")
    # weekends are busier
    day_w = np.where(days.day_of_week >= 5, 1.5, 1.0)
    day_w /= day_w.sum()
    customers = [f"C{c:05d}" for c in range(1, N_CUSTOMERS + 1)]

    rows = []
    for i in range(N_INVOICES):
        invoice = f"INV{100000 + i}"
        day = days[rng.choice(len(days), p=day_w)]
        ts = day + pd.Timedelta(hours=int(rng.integers(8, 22)), minutes=int(rng.integers(0, 60)))
        customer = rng.choice(customers) if rng.random() > 0.12 else ""  # 12% guest checkouts
        store = rng.choice(STORES, p=[0.45, 0.32, 0.23])
        for name in build_basket(rng, names, popularity, mission_cdf):
            p = by_name.loc[name]
            qty = int(rng.choice([1, 1, 1, 1, 2, 2, 3]))
            rows.append([invoice, ts.strftime("%Y-%m-%d %H:%M"), customer, store,
                         p.product_id, name, p.category, qty, p.unit_price])

    df = pd.DataFrame(rows, columns=["invoice_no", "invoice_datetime", "customer_id", "store_id",
                                     "product_id", "product_name", "category", "quantity", "unit_price"])

    # ---- inject realistic data-quality issues ----
    n = len(df)
    # inconsistent casing / whitespace in product names
    idx = rng.choice(n, size=int(n * 0.03), replace=False)
    df.loc[idx, "product_name"] = df.loc[idx, "product_name"].map(
        lambda s: rng.choice([s.upper(), s.lower(), f"  {s} "]))
    # missing product names (product_id still present, so recoverable)
    idx = rng.choice(n, size=int(n * 0.005), replace=False)
    df.loc[idx, "product_name"] = np.nan
    # exact duplicate line items (scanner double-reads)
    dupes = df.sample(frac=0.01, random_state=SEED)
    # partial returns: negative-quantity lines on existing invoices
    returns = df.sample(n=120, random_state=SEED + 1).copy()
    returns["quantity"] = -returns["quantity"]
    # cancelled invoices, flagged with a C prefix
    cancel_ids = rng.choice(df["invoice_no"].unique(), size=60, replace=False)
    cancelled = df[df["invoice_no"].isin(cancel_ids)].copy()
    cancelled["invoice_no"] = "C" + cancelled["invoice_no"]
    cancelled["quantity"] = -cancelled["quantity"].abs()
    # a few test/price-zero rows from the POS
    test_rows = df.sample(n=15, random_state=SEED + 2).copy()
    test_rows["unit_price"] = 0.0

    df = pd.concat([df, dupes, returns, cancelled, test_rows], ignore_index=True)
    df = df.sort_values(["invoice_datetime", "invoice_no"], kind="stable").reset_index(drop=True)

    (ROOT / "data" / "raw").mkdir(parents=True, exist_ok=True)
    df.to_csv(ROOT / "data" / "raw" / "transactions_raw.csv", index=False)
    products.drop(columns="weight").to_csv(ROOT / "data" / "products.csv", index=False)
    print(f"{len(df):,} raw line items, {df['invoice_no'].nunique():,} invoices, {len(products)} products")


if __name__ == "__main__":
    main()
