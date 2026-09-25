# End-to-end tests

Browser tests run with [Playwright for Python](https://playwright.dev/python/) against the demo mode
(no database needed) and against a fake Supabase client that records every call.

```
pip install playwright && playwright install chromium
python tests/e2e/demo_flow.py       # main flows in demo mode, desktop and phone
python tests/e2e/map.py             # map tab with a stub Leaflet and a stub geocoder
python tests/e2e/supabase_fake.py   # data layer against a recorded fake client (auth, roles, realtime)
```

Unit tests for the chain logic need only Node: `node tests/logic.test.js`.
