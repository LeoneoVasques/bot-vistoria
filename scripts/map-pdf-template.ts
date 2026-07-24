import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Script utilitário para gerar/testar arquivo de coordenadas JSON
 * para qualquer PDF na pasta pdf_base.
 * Uso: npx tsx scripts/map-pdf-template.ts [NomeDoPdf]
 */
async function main() {
  const args = process.argv.slice(2);
  const pdfBaseDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates', 'pdf_base');

  const files = fs.readdirSync(pdfBaseDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.error('❌ Nenhum PDF encontrado em:', pdfBaseDir);
    return;
  }

  const targetPdfFile = args[0]
    ? files.find((f) => f.toLowerCase().includes(args[0].toLowerCase())) || files[0]
    : files[0];

  const pdfPath = path.join(pdfBaseDir, targetPdfFile);
  const jsonPath = pdfPath.replace(/\.pdf$/i, '.json');

  console.log(`📄 Mapeando coordenadas para: ${targetPdfFile}`);

  let coordsConfig: Record<string, any> = {
    placa: { x: 105, y: 745, fontSize: 11, bold: true, page: 0 },
    modelo: { x: 240, y: 745, fontSize: 10, bold: true, page: 0 },
    ano: { x: 435, y: 745, fontSize: 10, page: 0 },
    cor: { x: 105, y: 718, fontSize: 10, page: 0 },
    quilometragem: { x: 240, y: 718, fontSize: 10, page: 0 },
    combustivel: { x: 435, y: 718, fontSize: 10, page: 0 },
    funilaria_pintura: { x: 105, y: 665, fontSize: 9, page: 0 },
    pneus_rodas: { x: 105, y: 625, fontSize: 9, page: 0 },
    vidros_farois: { x: 105, y: 585, fontSize: 9, page: 0 },
    interior_estofamento: { x: 105, y: 545, fontSize: 9, page: 0 },
    equipamentos_seguranca: { x: 105, y: 505, fontSize: 9, page: 0 },
    parecer_geral: { x: 105, y: 455, fontSize: 11, bold: true, page: 0 },
    observacoes: { x: 105, y: 410, fontSize: 9, page: 0 },
  };

  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      coordsConfig = JSON.parse(raw);
      console.log(`✅ Configuração JSON existente carregada de: ${jsonPath}`);
    } catch {
      console.warn('⚠️ Erro ao ler JSON existente, criando nova configuração.');
    }
  } else {
    fs.writeFileSync(jsonPath, JSON.stringify(coordsConfig, null, 2), 'utf8');
    console.log(`✨ Criado novo arquivo de configuração JSON em: ${jsonPath}`);
  }

  // Gera um PDF de teste visual para conferir a posição das marcas nas caixas
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const sampleData: Record<string, string> = {
    placa: 'ABC1D23',
    modelo: 'Fiat Uno Mille Fire 1.0',
    ano: '2012/2013',
    cor: 'Preta',
    quilometragem: '115.000 km',
    combustivel: 'Flex',
    funilaria_pintura: 'Pára-choque dianteiro com pequenos riscos de uso, lataria alinhada.',
    pneus_rodas: 'Pneus dianteiros em bom estado, traseiro esquerdo meia-vida.',
    vidros_farois: 'Parabrisa sem trincas, faróis com lentes translúcidas.',
    interior_estofamento: 'Estofamento limpo, sem rasgos.',
    equipamentos_seguranca: 'Estepe, macaco e chave de roda presentes.',
    parecer_geral: 'APROVADO_COM_APONTAMENTOS',
    observacoes: 'Vistoria realizada no local. Veículo liberado com apontamentos.',
  };

  for (const [key, pos] of Object.entries<any>(coordsConfig)) {
    const val = sampleData[key] || `[${key}]`;
    if (pos.page !== undefined && pages[pos.page]) {
      const page = pages[pos.page];
      page.drawText(String(val), {
        x: pos.x || 50,
        y: pos.y || 50,
        size: pos.fontSize || 10,
        font: pos.bold ? boldFont : font,
        color: rgb(0.8, 0.1, 0.1), // Vermelho para destaque no teste visual
      });
    }
  }

  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const testPdfPath = path.join(outputDir, `TESTE_MAPEAMENTO_${targetPdfFile}`);
  fs.writeFileSync(testPdfPath, await pdfDoc.save());

  console.log(`🎉 Teste de coordenadas salvo em: ${testPdfPath}`);
  console.log(`👉 Abra este PDF para conferir o alinhamento das informações nas caixas!`);
}

main().catch(console.error);
