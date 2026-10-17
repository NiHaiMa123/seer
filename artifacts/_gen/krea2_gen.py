"""TEMP art pipeline: queue Krea2 text-to-image jobs on local ComfyUI and download results.
usage: python krea2_gen.py jobs.json  (list of {name, prompt, w, h, seed?, neg?})
"""
import json, sys, time, urllib.request, urllib.parse, os, random

HOST = "http://127.0.0.1:8188"
OUT = os.path.join(os.path.dirname(__file__), "raw")
os.makedirs(OUT, exist_ok=True)
NEG_DEFAULT = ("text, letters, words, watermark, logo, signature, ui, interface, frame, border, photo, photorealistic, "
               "3d render plastic, blurry, lowres, jpeg artifacts, noisy, cropped, deformed")


def graph(prompt, neg, w, h, seed, prefix):
    return {
        "1": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2", "device": "default"}},
        "6": {"class_type": "UNETLoader", "inputs": {"unet_name": "Krea2_turbo_uncensored_edit_v1.1-fp8_scaled.safetensors", "weight_dtype": "default"}},
        "8": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["1", 0]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["1", 0]}},
        "10": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "4": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 8, "cfg": 1, "sampler_name": "euler", "scheduler": "simple",
                                                    "denoise": 1, "model": ["6", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["10", 0]}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["8", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["7", 0]}},
    }


def post(path, body):
    req = urllib.request.Request(HOST + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return json.load(urllib.request.urlopen(HOST + path))


def run(job):
    seed = job.get("seed", random.randint(1, 2**31))
    t0 = time.time()
    pid = post("/prompt", {"prompt": graph(job["prompt"], job.get("neg", NEG_DEFAULT), job["w"], job["h"], seed, "seerui/" + job["name"])})["prompt_id"]
    while True:
        time.sleep(1.5)
        h = get("/history/" + pid)
        if pid in h:
            break
    outs = h[pid]["outputs"]["9"]["images"]
    for i, im in enumerate(outs):
        q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im["subfolder"], "type": im["type"]})
        dst = os.path.join(OUT, f"{job['name']}.png" if i == 0 else f"{job['name']}_{i}.png")
        urllib.request.urlretrieve(HOST + "/view?" + q, dst)
    print(f"done {job['name']} seed={seed} {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    for j in jobs:
        run(j)
