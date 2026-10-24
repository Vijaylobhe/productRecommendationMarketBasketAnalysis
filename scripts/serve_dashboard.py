"""Serve the dashboard on this computer and open it in the default browser.

The server listens on 127.0.0.1 only, so nothing outside this machine can reach it.

Usage:  python scripts/serve_dashboard.py [--port 8000] [--no-browser]
"""
import argparse
import functools
import http.server
import webbrowser
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parents[1] / "dashboard"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    if not (DASHBOARD / "data.js").exists():
        raise SystemExit("dashboard/data.js is missing. Run: python scripts/build_dashboard_data.py")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DASHBOARD)
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        url = f"http://localhost:{args.port}/"
        print(f"Dashboard running at {url}  (press Ctrl+C to stop)")
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
