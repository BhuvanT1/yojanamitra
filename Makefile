.PHONY: install data test eval demo api ui all

install:
	pip install -r requirements.txt

data:
	python scripts/build_corpus.py
	python scripts/build_gold_set.py

test:
	pytest -q

eval:
	python -m eval.evaluate --json eval_report.json

demo:
	python demo.py --all

api:
	uvicorn yojanamitra.api:app --reload

ui:
	streamlit run app.py

all: data test eval
