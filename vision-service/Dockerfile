FROM python:3.9-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 appuser
WORKDIR /app

COPY requirements.txt .
# Plain "torch>=2.3" resolves to the default PyPI build, which bundles ~3GB
# of CUDA libraries no CPU-only host needs. Install the CPU wheel first so
# it already satisfies the requirements.txt constraint and pip skips it.
RUN pip install --no-cache-dir torch==2.8.0+cpu torchvision==0.23.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p data/enrollments && chown -R appuser:appuser /app

USER appuser

ENV CMOS_ENROLLMENTS_DIR=data/enrollments
EXPOSE 7860

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7860"]
