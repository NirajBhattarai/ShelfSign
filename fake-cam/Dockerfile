FROM python:3.9-slim

WORKDIR /app
COPY . .

EXPOSE 8788
ENV FAKE_CAM_HOST=0.0.0.0

CMD ["python3", "stdlib_server.py"]
