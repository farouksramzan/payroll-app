FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1
# Single worker on purpose: the in-process sender thread must be the only one
# draining the queue; --threads handles concurrent requests.
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT:-5601} -w 1 --threads 8 --timeout 120 app:app"]
