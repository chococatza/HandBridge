# test.py — ตรวจโครงสร้าง joblib
import joblib, numpy as np

obj = joblib.load("asl_svm.joblib")
print("type(obj):", type(obj))

if isinstance(obj, dict):
    print("keys:", list(obj.keys()))
    scaler = obj.get("scaler")
    clf    = obj.get("clf") or obj.get("model")
    labels = obj.get("labels")
    feats  = obj.get("feature_names", None)

    if scaler is not None:
        print("scaler:", type(scaler).__name__,
              "n_features_in_:", getattr(scaler, "n_features_in_", None))
    if clf is not None:
        print("clf:", type(clf).__name__,
              "n_features_in_:", getattr(clf, "n_features_in_", None),
              "has_proba:", hasattr(clf, "predict_proba"))
    if labels is not None:
        print("labels_len:", len(labels), "sample:", labels[:10])

    if feats is not None:
        print("feature_names_len:", len(feats))
        print("first_10_feature_names:", feats[:10])
else:
    print("model:", type(obj).__name__,
          "n_features_in_:", getattr(obj, "n_features_in_", None))