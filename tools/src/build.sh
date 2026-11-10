#!/bin/bash
# Assemble the single-file tool from its parts: ../room-pillar-scheduler.html
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  cat head.html
  printf '</head>\n<body>\n'
  cat body.html
  echo '<script>'
  cat app1.js app2.js app3.js
  printf '</script>\n</body>\n</html>\n'
} > ../room-pillar-scheduler.html
