import fs from 'fs';
import path from 'path';
import { checkOpenAIHealth } from '../src/modules/ai/ai.health';
import { gptService } from '../src/modules/ai/gpt.service';
import { pdfService } from '../src/modules/pdf/pdf.service';
import { inspectionService } from '../src/modules/inspection/inspection.service';
import { mediaStorageService } from '../src/modules/media/media.storage';
import { templateService } from '../src/modules/subscriber/template.service';
import { handleIncomingMessage } from '../src/modules/whatsapp/whatsapp.router';

async function runJourneyTest() {
  console.log('\n===============================================================');
  console.log('🧪 JORNADA DE TESTES AUTOMÁTICOS DO VISTORIABOT (E2E / SANITY)');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 5;

  const testPhone = '5511999998888@s.whatsapp.net';
  const testPlate = 'TESTE99';

  // TESTE 1: Validação de IA & OpenAI Health
  console.log('📌 [TESTE 1/5] Verificando conexões de IA (OpenAI API Health Check)...');
  try {
    const health = await checkOpenAIHealth(true);
    if (health.ok) {
      console.log('   ✅ PASSOU: Conexão com GPT-4o-mini & Whisper operacional!');
      passedTests++;
    } else {
      console.warn(`   ⚠️ ALERTA IA: ${health.reason}`);
    }
  } catch (err) {
    console.error('   ❌ FALHOU no Teste 1:', err);
  }

  // TESTE 2: Upload de Ficha PDF Personalizada do Cliente
  console.log('\n📌 [TESTE 2/5] Testando cadastro de Ficha PDF Personalizada do Cliente...');
  try {
    // Cria um buffer de PDF mínimo válido
    const dummyPdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kinds [] /Count 0 >> endobj
xref
0 3
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
trailer << /Size 3 /Root 1 0 R >>
startxref
102
%%EOF`;

    const dummyBuffer = Buffer.from(dummyPdfContent);
    const templateResult = await templateService.saveCustomTemplate(
      testPhone,
      dummyBuffer,
      'Ficha_Empresa_Teste.pdf'
    );

    const activeTemplate = await templateService.getActiveTemplatePath(testPhone);
    if (activeTemplate && fs.existsSync(activeTemplate)) {
      console.log(`   ✅ PASSOU: Ficha cadastrada com sucesso! Caminho: ${activeTemplate}`);
      passedTests++;
    } else {
      console.error('   ❌ FALHOU: Ficha não foi gravada no disco/R2.');
    }
  } catch (err) {
    console.error('   ❌ FALHOU no Teste 2:', err);
  }

  // TESTE 3: Armazenamento de Mídia Híbrido (Local + Cloudflare R2)
  console.log('\n📌 [TESTE 3/5] Testando persistência de mídias e Cloudflare R2...');
  try {
    const dummyImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const savedImgPath = await mediaStorageService.saveImage(dummyImageBuffer, 'image/png');

    if (savedImgPath && (savedImgPath.startsWith('http') || fs.existsSync(savedImgPath))) {
      console.log(`   ✅ PASSOU: Imagem salva com sucesso! Caminho/URL: ${savedImgPath}`);
      passedTests++;
    } else {
      console.error('   ❌ FALHOU: Falha no salvamento da imagem.');
    }
  } catch (err) {
    console.error('   ❌ FALHOU no Teste 3:', err);
  }

  // TESTE 4: Extração GPT-4o + Geração de PDF via Puppeteer Pool
  console.log('\n📌 [TESTE 4/5] Testando Extração IA + Gerador de PDF...');
  try {
    const mockNotes = [
      'Veículo Gol Prata ano 2021, KM 54000',
      'Lataria com pequeno risco na porta traseira esquerda',
      'Pneus dianteiros novos, estofamento higienizado',
    ];

    const extracted = await gptService.extractInspectionData(testPlate, mockNotes);
    console.log(`   ℹ️ Parecer extraído pela IA: "${extracted.parecer_geral}"`);

    const pdfPath = await pdfService.generateInspectionPDF(extracted, []);
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000) {
      console.log(`   ✅ PASSOU: PDF do laudo gerado em ${pdfPath} (${fs.statSync(pdfPath).size} bytes)!`);
      passedTests++;
      // Limpa arquivo de teste
      fs.promises.unlink(pdfPath).catch(() => {});
    } else {
      console.error('   ❌ FALHOU: Arquivo PDF gerado inválido ou vazio.');
    }
  } catch (err) {
    console.error('   ❌ FALHOU no Teste 4:', err);
  }

  // TESTE 5: Simulação do Router de Mensagens do WhatsApp
  console.log('\n📌 [TESTE 5/5] Simulando recebimento de mensagens no WhatsApp Router...');
  try {
    let mockSentText = '';
    const mockSocket = {
      sendMessage: async (jid: string, content: any) => {
        if (content?.text) mockSentText = content.text;
      },
    };

    const mockMsg: any = {
      key: { remoteJid: testPhone, fromMe: false },
      message: { conversation: '!teste' },
    };

    await handleIncomingMessage(mockMsg, mockSocket);

    if (mockSentText.includes('Pong!')) {
      console.log(`   ✅ PASSOU: Resposta do Router simulada com sucesso! Resposta: "${mockSentText}"`);
      passedTests++;
    } else {
      console.error('   ❌ FALHOU: Resposta inesperada do router.');
    }
  } catch (err) {
    console.error('   ❌ FALHOU no Teste 5:', err);
  }

  // Limpeza de Sessão
  await inspectionService.removeSession(testPhone);

  console.log('\n===============================================================');
  console.log(`📊 RESULTADO DA JORNADA DE TESTES: ${passedTests}/${totalTests} PASSO(S) COM SUCESSO!`);
  if (passedTests === totalTests) {
    console.log('🚀 SISTEMA TOTALMENTE ESTÁVEL E PRONTO PARA OPERAÇÃO!');
  } else {
    console.warn('⚠️ ALGUNS TESTES APRESENTARAM ALERTAS. VERIFIQUE OS LOGS ACIMA.');
  }
  console.log('===============================================================\n');

  process.exit(passedTests === totalTests ? 0 : 1);
}

runJourneyTest();
