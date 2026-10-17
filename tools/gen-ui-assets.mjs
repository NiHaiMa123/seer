/** gen-ui-assets.mjs —— ComfyUI 批量生成 UI 资产（Krea2 turbo 管线）。用法: node tools/gen-ui-assets.mjs
 * 产出到 ComfyUI output 目录, 白底件需再经 tools/_prep 抠图或直接重跑。
 * 管线: UNETLoader(krea2_turbo) + CLIPLoader(qwen3vl_4b, type=krea2) + VAELoader(qwen_image_vae)
 */
const BASE = "http://127.0.0.1:8188";
const STYLE = "flat cel-shaded game art, clean shapes, rich colors";
const NEG = "blurry, photo, realistic, watermark, text, logo, signature, lowres, noisy, grain";
const jobs = [
  { name: "bg_arena_a", w: 1344, h: 768, steps: 10, cfg: 4.5,
    text: `epic fantasy battle arena background, wide panoramic view, ancient floating stone platforms over a glowing abyss, dramatic dusk sky with teal aurora ribbons, distant broken pillars and ruins, warm rim light, empty center stage, ${STYLE}` },
  { name: "bg_arena_b", w: 1344, h: 768, steps: 10, cfg: 4.5,
    text: `fantasy battle arena background, wide panoramic view, circular stone dueling platform carved with glowing cyan rune rings, crystal spires in distance, deep blue night sky with two moons and drifting clouds, mist below, empty center stage, ${STYLE}` },
  { name: "panel_frame", w: 768, h: 512, steps: 8, cfg: 4,
    text: `single rectangular dark navy blue sci-fi game UI panel, thin glowing cyan border, subtle hexagon texture inside, angular cut corners, small decorative tech details in corners, flat front view, centered on pure white background, game asset, ${STYLE}` },
  { name: "btn_skill", w: 512, h: 512, steps: 8, cfg: 4,
    text: `single square game skill button tile, dark steel-blue metallic frame with glowing cyan inner border and angular notches, dark blue gradient center, game UI asset, flat front view, centered on pure white background, ${STYLE}` },
  { name: "btn_legend", w: 512, h: 512, steps: 8, cfg: 4,
    text: `single square game legendary ultimate-skill button tile, ornate golden metal frame with glowing amber inner border and wing-like corner ornaments, radiant orange gradient center, game UI asset, flat front view, centered on pure white background, ${STYLE}` },
];
function wfFor(j) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "Krea2" + String.fromCharCode(92) + "krea2_turbo_int8_convrot.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: j.text, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: ["2", 0] } },
    "6": { class_type: "EmptyLatentImage", inputs: { width: j.w, height: j.h, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], seed: 7, steps: j.steps, cfg: j.cfg, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], denoise: 1.0 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `ui_${j.name}` } },
  };
}
for (const j of jobs) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: wfFor(j) }) });
  const sub = await r.json();
  if (r.status !== 200) { console.log(`${j.name}: submit-fail ${r.status}`, JSON.stringify(sub).slice(0, 200)); continue; }
  let done = false;
  for (let i = 0; i < 150 && !done; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const h = await (await fetch(`${BASE}/history/${sub.prompt_id}`)).json();
    const e = h[sub.prompt_id];
    const st = e?.status?.status_str;
    if (st === "success" || e?.status?.completed === true) { console.log(`${j.name}: OK ${((Date.now() - t0) / 1000).toFixed(0)}s`); done = true; }
    else if (st === "error" || e?.status?.messages?.some((m) => m[0] === "execution_error")) { console.log(`${j.name}: FAIL`, JSON.stringify(e.status).slice(0, 300)); done = true; }
  }
  if (!done) console.log(`${j.name}: TIMEOUT`);
}
