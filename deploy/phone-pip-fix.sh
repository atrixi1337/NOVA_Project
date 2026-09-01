#!/data/data/com/termin/files/usr/bin/bash
# phone-pip-fix.sh — build native deps on Termux with the Android API level set.
set -uo pipefail
D="$HOME/NOVA_Project"; cd "$D" || exit 1

export ANDROID_API_LEVEL=24          # fixes maturin/PyO3 "Failed to determine Android API level"
export PYO3_PYTHON="$D/.venv/bin/python"   # bind pyo3 against the venv interpreter
export CARGO_BUILD_JOBS=4            # cap parallel rustc jobs for phone memory safety
termux-wake-lock 2>/dev/null || echo "[pipfix] wake-lock failed"

echo "[pipfix] ensure wheel+setuptools present"
.venv/bin/python -m pip install --no-cache-dir wheel setuptools > "$HOME/pip-wheel.log" 2>&1 && echo "[pipfix] wheel/setuptools OK" || tail -15 "$HOME/pip-wheel.log"

echo "[pipfix] pre-build maturin (reused via --no-build-isolation, avoids per-run rebuild)"
.venv/bin/python -m pip install --no-cache-dir maturin > "$HOME/pip-maturin.log" 2>&1 && echo "[pipfix] maturin built OK" || { echo "MATURIN_FAIL"; tail -25 "$HOME/pip-maturin.log"; }

echo "[pipfix] build pydantic-core==2.46.5 (Rust, reuses venv maturin)"
.venv/bin/python -m pip install --no-cache-dir --no-build-isolation pydantic-core==2.46.5 > "$HOME/pip-pydantic.log" 2>&1 && echo "[pipfix] pydantic-core built OK" || { echo "PYDANTIC_FAIL"; tail -30 "$HOME/pip-pydantic.log"; }

echo "[pipfix] install remaining (pure-wheel) requirements"
.venv/bin/python -m pip install --no-cache-dir -r requirements.phone.txt > "$HOME/pip-rest.log" 2>&1 && echo "[pipfix] rest OK" || tail -30 "$HOME/pip-rest.log"

echo "[pipfix] verify imports"
.venv/bin/python -c "import fastapi,uvicorn,httpx,multipart,pydantic,pydantic_core; from Evtx.Evtx import Evtx; print('IMPORTS_OK uv',uvicorn.__version__,'pyd',pydantic.__version__,'core',pydantic_core.__version__)" || echo "IMPORTS_FAIL"
echo "PIPFIX_DONE"
