# Lookabout home hub. Builds for the machine it is built on, so
# `docker compose up -d --build` on a 64-bit Raspberry Pi gives an arm64 image.

# go2rtc (MIT) bridges the cameras. Built from source so the Go checksum
# database vouches for it.
FROM golang:1.26-bookworm AS go2rtc
ARG GO2RTC_VERSION=v1.9.15
RUN CGO_ENABLED=0 GOBIN=/out go install -trimpath -ldflags "-s -w" github.com/AlexxIT/go2rtc@${GO2RTC_VERSION}

FROM python:3.13-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=go2rtc /out/go2rtc /usr/local/bin/go2rtc

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY lookabout_hub ./lookabout_hub

# Not root. The video group lets it open USB webcams passed in from the host.
RUN useradd --system --uid 1000 --groups video hub && mkdir /data && chown hub /data
USER hub
VOLUME /data
ENV LOOKABOUT_HUB_DATA=/data PYTHONUNBUFFERED=1
EXPOSE 8787 8555/tcp 8555/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python3 -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/api/hub' % os.environ.get('LOOKABOUT_HUB_PORT','8787'), timeout=4)"
CMD ["python3", "-m", "lookabout_hub"]
