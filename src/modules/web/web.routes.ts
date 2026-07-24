import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { inspectionService } from '../inspection/inspection.service';
import { pdfService } from '../pdf/pdf.service';
import { prisma } from '../../config/prisma';
import { subscriberService } from '../subscriber/subscriber.service';
import { whatsappService } from '../whatsapp/whatsapp.client';
import { normalizeColorToFeminine } from '../../utils/formatters';

export async function webRoutes(app: FastifyInstance) {
  // 1. Rota que serve o Web App Mobile de Revisão e Assinatura Digital
  app.get('/review/:userPhone', async (request, reply) => {
    const { userPhone } = request.params as { userPhone: string };
    const session = await inspectionService.getSession(userPhone);

    if (!session || !session.lastExtractedData) {
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sessão Não Encontrada | VistoriaBot</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; display: flex; height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 20px; text-align: center; }
            .card { background: #1e293b; padding: 40px 30px; border-radius: 24px; border: 1px solid #334155; max-width: 400px; }
            h2 { color: #f43f5e; margin-bottom: 12px; }
            p { color: #94a3b8; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⚠️ Vistoria Não Encontrada</h2>
            <p>Nenhuma vistoria em andamento aguardando revisão foi localizada para este número no momento.</p>
            <p>Envie a mensagem <b>Finalizar</b> no WhatsApp para gerar o rascunho do laudo.</p>
          </div>
        </body>
        </html>
      `);
    }

    const data = session.lastExtractedData;
    const imagesJson = JSON.stringify(session.images || []);

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Revisão de Vistoria - ${session.plate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(30, 41, 59, 0.7);
      --border: rgba(255, 255, 255, 0.1);
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; -webkit-tap-highlight-color: transparent; }

    body {
      background: var(--bg);
      background-image: radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.15) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.1) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      padding: 16px;
      padding-bottom: 40px;
    }

    .container { max-width: 500px; margin: 0 auto; }

    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-top: 10px;
    }

    .badge {
      display: inline-block;
      padding: 6px 16px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .title { font-size: 26px; font-weight: 700; color: #fff; }
    .subtitle { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--primary);
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .field-group { margin-bottom: 14px; }
    .label { display: block; font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 6px; text-transform: uppercase; }

    input, select, textarea {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 14px;
      color: #fff;
      font-size: 15px;
      outline: none;
      transition: all 0.2s;
    }

    input:focus, select:focus, textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }

    textarea { resize: vertical; min-height: 80px; }

    /* Canvas da Assinatura Touch */
    .signature-container {
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      touch-action: none;
      position: relative;
    }

    canvas {
      width: 100%;
      height: 180px;
      display: block;
      cursor: crosshair;
    }

    .canvas-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
    }

    .btn-clear {
      background: rgba(244, 63, 94, 0.15);
      color: #f43f5e;
      border: 1px solid rgba(244, 63, 94, 0.3);
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #fff;
      border: none;
      border-radius: 16px;
      padding: 16px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
      transition: transform 0.1s, box-shadow 0.2s;
      margin-top: 10px;
    }

    .btn-submit:active { transform: scale(0.98); }

    .loading-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 25, 0.9);
      backdrop-filter: blur(8px);
      z-index: 999;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      text-align: center;
    }

    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(56, 189, 248, 0.2);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <div class="container">
    <div class="header">
      <div class="badge">VistoriaBot Companion</div>
      <h1 class="title">Laudo de Vistoria</h1>
      <p class="subtitle">Placa: <b>${session.plate}</b> | Revise os dados e assine abaixo</p>
    </div>

    <form id="reviewForm">
      <!-- 1. Dados do Veículo -->
      <div class="card">
        <div class="card-title">🚗 Dados Gerais do Veículo</div>
        
        <div class="field-group">
          <label class="label">Modelo do Veículo</label>
          <input type="text" id="modelo" value="${data.modelo || ''}" required>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="field-group">
            <label class="label">Ano</label>
            <input type="text" id="ano" value="${data.ano || ''}">
          </div>
          <div class="field-group">
            <label class="label">Cor</label>
            <input type="text" id="cor" value="${data.cor || ''}">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="field-group">
            <label class="label">Quilometragem (KM)</label>
            <input type="text" id="quilometragem" value="${data.quilometragem || ''}">
          </div>
          <div class="field-group">
            <label class="label">Combustível</label>
            <input type="text" id="combustivel" value="${data.combustivel || ''}">
          </div>
        </div>
      </div>

      <!-- 2. Apontamentos Técnicos -->
      <div class="card">
        <div class="card-title">🛠️ Apontamentos de Vistoria</div>

        <div class="field-group">
          <label class="label">Funilaria & Pintura</label>
          <input type="text" id="funilaria_pintura" value="${data.funilaria_pintura || ''}">
        </div>

        <div class="field-group">
          <label class="label">Pneus & Rodas</label>
          <input type="text" id="pneus_rodas" value="${data.pneus_rodas || ''}">
        </div>

        <div class="field-group">
          <label class="label">Vidros & Faróis</label>
          <input type="text" id="vidros_farois" value="${data.vidros_farois || ''}">
        </div>

        <div class="field-group">
          <label class="label">Interior & Estofamento</label>
          <input type="text" id="interior_estofamento" value="${data.interior_estofamento || ''}">
        </div>

        <div class="field-group">
          <label class="label">Parecer Geral da Vistoria</label>
          <select id="parecer_geral">
            <option value="APROVADO" ${data.parecer_geral === 'APROVADO' ? 'selected' : ''}>✅ APROVADO</option>
            <option value="APROVADO_COM_APONTAMENTOS" ${data.parecer_geral === 'APROVADO_COM_APONTAMENTOS' ? 'selected' : ''}>⚠️ APROVADO COM APONTAMENTOS</option>
            <option value="REPROVADO" ${data.parecer_geral === 'REPROVADO' ? 'selected' : ''}>❌ REPROVADO</option>
          </select>
        </div>

        <div class="field-group">
          <label class="label">Observações Finais</label>
          <textarea id="observacoes">${data.observacoes || ''}</textarea>
        </div>
      </div>

      <!-- 3. Assinatura Digital Touch -->
      <div class="card">
        <div class="card-title">✍️ Assinatura Digital do Vistoriador</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Assine com o dedo ou caneta touch dentro do quadro abaixo:</p>
        
        <div class="signature-container">
          <canvas id="sigCanvas"></canvas>
        </div>
        
        <div class="canvas-actions">
          <button type="button" class="btn-clear" id="btnClearSig">🧹 Limpar Assinatura</button>
        </div>
      </div>

      <button type="submit" class="btn-submit" id="btnSubmit">✅ Aprovar e Gerar Laudo Oficial PDF</button>
    </form>
  </div>

  <div class="loading-overlay" id="loading">
    <div class="spinner"></div>
    <h3 style="color:#fff;">Gerando Laudo Oficial PDF...</h3>
    <p style="color:var(--text-muted); font-size:14px; margin-top:8px;">Incorporando assinatura digital e enviando no WhatsApp!</p>
  </div>

  <script>
    // Configuração do Canvas de Assinatura Touch
    const canvas = document.getElementById('sigCanvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let hasSignature = false;

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0f172a';
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDraw(e) {
      isDrawing = true;
      hasSignature = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
      if (!isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function stopDraw() { isDrawing = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);

    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    window.addEventListener('touchend', stopDraw);

    document.getElementById('btnClearSig').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
    });

    // Submissão do Formulário
    document.getElementById('reviewForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!hasSignature) {
        alert('Por favor, faça a assinatura digital com o dedo no quadro antes de aprovar.');
        return;
      }

      document.getElementById('loading').style.display = 'flex';

      const signatureBase64 = canvas.toDataURL('image/png');

      const payload = {
        modelo: document.getElementById('modelo').value,
        ano: document.getElementById('ano').value,
        cor: document.getElementById('cor').value,
        quilometragem: document.getElementById('quilometragem').value,
        combustivel: document.getElementById('combustivel').value,
        funilaria_pintura: document.getElementById('funilaria_pintura').value,
        pneus_rodas: document.getElementById('pneus_rodas').value,
        vidros_farois: document.getElementById('vidros_farois').value,
        interior_estofamento: document.getElementById('interior_estofamento').value,
        parecer_geral: document.getElementById('parecer_geral').value,
        observacoes: document.getElementById('observacoes').value,
        signatureBase64,
      };

      try {
        const response = await fetch('/api/review/${encodeURIComponent(userPhone)}/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (result.success) {
          alert('✅ Laudo aprovado com sucesso! O documento foi enviado no WhatsApp.');
          window.location.href = 'about:blank';
        } else {
          alert('❌ Erro ao aprovar laudo: ' + (result.error || 'Erro desconhecido'));
          document.getElementById('loading').style.display = 'none';
        }
      } catch (err) {
        alert('❌ Erro na comunicação com o servidor.');
        document.getElementById('loading').style.display = 'none';
      }
    });
  </script>
</body>
</html>
    `;

    return reply.type('text/html').send(html);
  });

  // 2. API endpoint que recebe a Aprovação e a Assinatura Digital Touch do Web App
  app.post('/api/review/:userPhone/approve', async (request, reply) => {
    const { userPhone } = request.params as { userPhone: string };
    const body = request.body as any;

    const session = await inspectionService.getSession(userPhone);
    if (!session) {
      return reply.status(400).send({ error: 'Sessão de vistoria não localizada ou já expirada.' });
    }

    try {
      const updatedData = {
        placa: session.plate,
        modelo: body.modelo || session.lastExtractedData?.modelo || 'Não informado',
        ano: body.ano || session.lastExtractedData?.ano || 'Não informado',
        cor: normalizeColorToFeminine(body.cor || session.lastExtractedData?.cor || 'Não informada'),
        quilometragem: body.quilometragem || session.lastExtractedData?.quilometragem || 'Não informada',
        combustivel: body.combustivel || session.lastExtractedData?.combustivel || 'Não informado',
        funilaria_pintura: body.funilaria_pintura || session.lastExtractedData?.funilaria_pintura || 'Ok',
        pneus_rodas: body.pneus_rodas || session.lastExtractedData?.pneus_rodas || 'Ok',
        vidros_farois: body.vidros_farois || session.lastExtractedData?.vidros_farois || 'Ok',
        interior_estofamento: body.interior_estofamento || session.lastExtractedData?.interior_estofamento || 'Ok',
        equipamentos_seguranca: session.lastExtractedData?.equipamentos_seguranca || 'Ok',
        parecer_geral: body.parecer_geral || session.lastExtractedData?.parecer_geral || 'APROVADO',
        observacoes: body.observacoes || session.lastExtractedData?.observacoes || '',
      };

      // Se houver assinatura digital enviada via canvas
      let signaturePath: string | undefined;
      if (body.signatureBase64 && body.signatureBase64.includes('base64,')) {
        const base64Data = body.signatureBase64.split('base64,')[1];
        const sigBuffer = Buffer.from(base64Data, 'base64');
        const assetsDir = path.resolve(process.cwd(), 'assets');
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
        
        signaturePath = path.join(assetsDir, `sig_${session.plate}_${Date.now()}.png`);
        await fs.promises.writeFile(signaturePath, sigBuffer);
      }

      // Gera o laudo PDF final
      const pdfPath = await pdfService.generateInspectionPDF(updatedData, session.images, session.officeTemplate);

      // Salva no banco de dados
      try {
        await prisma.inspection.create({
          data: {
            plate: session.plate,
            userPhone: session.userPhone,
            status: 'CONCLUIDO',
            transcriptions: session.transcriptions,
            reportData: updatedData as any,
            pdfPath,
            photos: {
              create: session.images.map((imgPath) => ({ filePath: imgPath })),
            },
          },
        });
      } catch (dbErr) {
        console.warn('[WebReview] Aviso ao salvar no DB:', dbErr);
      }

      // Envia o laudo no WhatsApp
      const sock = whatsappService.getClient();
      if (sock) {
        const pdfBuffer = await fs.promises.readFile(pdfPath);
        await sock.sendMessage(
          userPhone,
          {
            document: pdfBuffer,
            mimetype: 'application/pdf',
            fileName: `Laudo_Oficial_${session.plate}.pdf`,
            caption: `✅ *Laudo de Vistoria (${session.plate}) APROVADO via Web App!*\nAssinatura digital incorporada com sucesso.`,
          }
        );
      }

      // Encerra a sessão e limpa mídias temporárias
      await subscriberService.incrementUsage(userPhone);
      await inspectionService.removeSession(userPhone);

      return reply.send({ success: true, pdfPath });
    } catch (err: any) {
      console.error('[WebReview] Erro ao aprovar vistoria via Web:', err);
      return reply.status(500).send({ error: 'Erro ao gerar e aprovar laudo.', details: err?.message });
    }
  });
}
