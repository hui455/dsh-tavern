"""OpenAI-compatible routes using the existing Voice Cast generation lifecycle."""
import asyncio
import subprocess
from pathlib import Path
from typing import Literal, Optional
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

class SpeechRequest(BaseModel):
    model: str = 'gpt-sovits'
    input: str = Field(min_length=1, max_length=500)
    voice: str = Field(min_length=1, max_length=300)
    response_format: Literal['mp3', 'wav'] = 'mp3'
    speed: float = Field(default=1.0, ge=0.6, le=1.65)
    request_id: Optional[str] = Field(default=None, max_length=120)

def register(app, list_characters, generate, request_type, output_root, ffmpeg):
    @app.get('/v1/models')
    async def models():
        return {'object':'list','data':[{'id':'gpt-sovits','object':'model','owned_by':'local'}]}

    @app.get('/v1/audio/voices')
    async def voices():
        result = await list_characters()
        return {'voices': result['characters']}

    @app.post('/v1/audio/speech')
    async def speech(body: SpeechRequest):
        if body.model != 'gpt-sovits':
            raise HTTPException(400, '模型请填写 gpt-sovits')
        names = (await list_characters())['characters']
        exact = [c for c in names if c['id'] == body.voice]
        matches = exact or [c for c in names if c['name'] == body.voice]
        if len(matches) != 1:
            raise HTTPException(400, '音色不存在或不唯一，请填写角色 ID')
        # Preserve the original queue, model switching, cold-start, idempotency,
        # history, failure recovery and idle-release behavior.
        params = dict(character=matches[0]['id'], text=body.input, speed_factor=body.speed)
        if body.request_id is not None:
            params['request_id'] = body.request_id
        result = await generate(request_type(**params))
        source = str(result.get('audio_url',''))
        name = source.removeprefix('/audio/')
        if not source.startswith('/audio/') or not name.endswith('.wav') or '/' in name or '\\' in name or '..' in name:
            raise HTTPException(502, '生成服务返回无效音频路径')
        audio = Path(output_root) / name
        if not audio.is_file():
            raise HTTPException(502, '生成的音频文件不存在')
        if body.response_format == 'wav':
            return FileResponse(audio, media_type='audio/wav')
        def encode():
            try:
                proc = subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-i', str(audio), '-f', 'mp3', '-codec:a', 'libmp3lame', '-b:a', '128k', 'pipe:1'], capture_output=True, timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            except (OSError, subprocess.TimeoutExpired) as error:
                raise HTTPException(502, 'MP3 转码失败，原 WAV 已保留') from error
            if proc.returncode or not proc.stdout:
                raise HTTPException(502, 'MP3 转码失败，原 WAV 已保留')
            return proc.stdout
        return Response(await asyncio.to_thread(encode), media_type='audio/mpeg', headers={'Cache-Control':'no-store'})
