#!/usr/bin/env python3
"""Consistent SQLite snapshot of the live Nova DB (run ON the phone).

sqlite3's online backup API produces a clean copy even while uvicorn is
writing (WAL mode), so backups never race the server. Writes the snapshot
to ~/nova_db_snapshot.db for the dev box to pull.
"""
import os
import sqlite3

DB = os.path.expanduser("~/NOVA_Project/nova_history.db")
OUT = os.path.expanduser("~/nova_db_snapshot.db")

src = sqlite3.connect(DB)
dst = sqlite3.connect(OUT)
src.backup(dst)
dst.close()
src.close()
print("snapshot ok:", OUT)
