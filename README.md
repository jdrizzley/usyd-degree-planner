# USyd Degree Planner

Pick your University of Sydney degree, see what it requires, and lay out a semester-by-semester
study plan you can drag around. Prerequisite problems are highlighted as you go, and your plan is
saved in the page address, so a bookmark brings it back. No login.

**Unofficial.** This project is not affiliated with, endorsed by, or maintained by the University
of Sydney. Rules are read from the public handbook and unit pages and may be out of date or
simplified. Always check the handbook and your faculty before enrolling.

## How it works

There is no server. Scheduled GitHub Actions jobs run the Python scraper, which reads the public
handbook and unit pages and commits static JSON into `data/planner/`. The website is plain HTML,
CSS and JavaScript (no build step) that reads that JSON. GitHub Pages hosts it.

```
GitHub Actions                                     GitHub Pages
  planner_scraper/ -> sydney.edu.au                  index.html + js/
  -> data/planner/*.json -> commit                   fetch('data/planner/...')
```

## Layout

| Path | What |
|---|---|
| `index.html`, `styles.css`, `js/` | the website |
| `js/tests/` | engine tests (`node --test js/tests/`) |
| `data/planner/` | published data, written by the scraper bot. Don't edit by hand |
| `data/planner-sample/` | real data for 3 degrees (BSc, BE(Hons) Software, BCom), used while the scraper is built |
| `planner_scraper/` | the scraper, rule parser and data validator |
| `tools/make_sample.py` | rebuilds `data/planner-sample/` |

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000/?data=sample
```

`?data=sample` uses the sample data. Without it the site uses `data/planner/`, and falls back to
the sample if that hasn't been published yet.

## Tests

```bash
pip install -r planner_scraper/requirements.txt
python -m pytest planner_scraper/tests -q
python -m planner_scraper.validate data/planner-sample
node --test js/tests/
```

## Rebuilding the sample data

```bash
python tools/make_sample.py --cache .cache/sample --out data/planner-sample
```

This makes about 200 requests to sydney.edu.au at one per second, cached in `.cache/`.

## Politeness

The scraper identifies itself (`usyd-degree-planner/1.0 (+repo URL; student project)`), follows
`robots.txt`, makes at most one request per second, and stores no personal data (staff names or
emails).
