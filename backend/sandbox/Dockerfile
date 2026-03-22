FROM python:3.11-slim

RUN apt-get update && apt-get install -y nodejs npm curl && rm -rf /var/lib/apt/lists/*
RUN pip install pandas numpy matplotlib requests openpyxl
RUN useradd -m sandbox
USER sandbox
WORKDIR /workspace
