from fastapi import APIRouter

router = APIRouter()

# TODO: POST /cmos/enroll — capture calibration frames, extract PRNU/impurity template,
#   store template keyed by cameraAccount
# TODO: POST /cmos/match — extract residual fingerprint from a frame, compare to enrolled
#   template, return match score + pass/fail
