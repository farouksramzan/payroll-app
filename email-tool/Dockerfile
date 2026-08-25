FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT:-5599} -w 2 --timeout 300 app:app"]
