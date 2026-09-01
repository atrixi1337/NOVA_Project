#!/data/data/com.termin/files/usr/bin/bash
# phone-prep.sh — clean venv, install rust toolchain, build deps (pydantic-core compiles via rust).
set -uo pipefail
D="$HOME/NOVA_Project"
cd "$D" || { echo "NOVA_Project missing"; exit 1; }

# stop stale deploy (narrow pattern so it can't kill this shell)
pkill -f 'phone-deploy.sh' 2>/dev/null || true; sleep 1

echo "[prep] recreate venv cleanly"
rm -rf .venv
python -m venv .venv
[ -x .venv/bin/python ] && echo "[prep] venv python OK" || { echo "[prep] venv creation FAILED"; exit 1; }

echo "[prep] rust toolchain (needed: pydantic-core is Rust)"
if ! command -v rustc >/dev/null 2>&1; then
  echo "[prep] installing rust via pkg (this is a big download) ..."
  pkg install -y rust > "$HOME/rust-install.log" 2>&1 || { echo "[prep] rust install FAILED"; tail -20 "$HOME/rust-install.log"; }
fi
command -v rustc && rustc --version
command -v cargo && cargo --version

echo "[prep] build deps (uvicorn plain -> skips watchfiles/uvloop/httptools C/Rust builds)"
sed 's/uvicorn\[standard\]==/uvicorn==/' requirements.txt > requirements.phone.txt
.venv/bin/pip install --no-cache-dir -r requirements.phone.txt > "$HOME/pip-install.log" 2>&1
echo "[prep] pip EXIT=$?"
tail -8 "$HOME/pip-install.log"

echo "[prep] verify imports"
.venv/bin/python -c "import fastapi,uvicorn,httpx,multipart,pydantic,pydantic_core; from Evtx.Evtx import Evtx; print('IMPORTS_OK uv',uvicorn.__version__,'pydantic',pydantic.__version__,'core',pydantic_core.__version__)" \
  || { echo "[prep] IMPORTS FAIL"; tail -30 "$D/nova-app.log" 2>/dev/null; }
echo "PREP_DONE"
