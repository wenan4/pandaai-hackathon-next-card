from pathlib import Path
import json
import time
import wave
import os

ROOT = Path(__file__).resolve().parent
os.environ['HF_HOME'] = str(ROOT / 'model-cache')
os.environ['HF_HUB_DISABLE_XET'] = '1'
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

def stamp(seconds):
    minutes, secs = divmod(int(seconds), 60)
    return f'{minutes:02d}:{secs:02d}'

source = next(ROOT.parent.glob('*.mp4'))
audio = decode_audio(str(source), sampling_rate=16000)
with wave.open(str(ROOT / 'organizer-audio.wav'), 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(16000)
    out.writeframes((audio * 32767).astype('int16').tobytes())
print(f'Audio extracted: {len(audio)/16000:.1f}s', flush=True)
model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=6,
                     download_root=str(ROOT / 'model-cache'))
print('Model ready', flush=True)
segments, info = model.transcribe(audio, language='zh', beam_size=5,
    vad_filter=True, condition_on_previous_text=False,
    initial_prompt='PandaAI，Panda Data，QuantSkills，苏客松，用户画像，游戏，量化，个性化推荐。')
rows = []
with (ROOT / 'organizer-transcript-raw.txt').open('w', encoding='utf-8') as out:
    out.write('主办方赛题讲解自动转写（Whisper small；专有名词和口误需结合上下文核对）\n')
    for seg in segments:
        row = {'start': seg.start, 'end': seg.end, 'text': seg.text,
               'avg_logprob': seg.avg_logprob, 'no_speech_prob': seg.no_speech_prob}
        rows.append(row)
        line = f'[{stamp(seg.start)}–{stamp(seg.end)}] {seg.text.strip()}'
        out.write(line + '\n')
        out.flush()
        print(line, flush=True)
(ROOT / 'organizer-transcript-segments.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'COMPLETE: {len(rows)} segments; duration {info.duration:.1f}s', flush=True)
