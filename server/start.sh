#!/bin/bash
set -a
[ -f .env ] && . ./.env
set +a
exec npm start
