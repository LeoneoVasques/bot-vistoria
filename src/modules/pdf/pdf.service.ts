import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
import puppeteer, { Browser } from 'puppeteer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { ExtractedInspectionData } from '../ai/gpt.service';
import { normalizeColorToFeminine } from '../../utils/formatters';

export class PDFService {
  private outputDir = path.resolve(process.cwd(), 'output');
  private pdfBaseDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates', 'pdf_base');
  private hbsTemplatesDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates');
  private sharedBrowser: Browser | null = null;

  constructor() {
    this.ensureDirectory();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.sharedBrowser && this.sharedBrowser.connected) {
      return this.sharedBrowser;
    }

    console.log('[PDFService] Inicializando instância compartilhada do Puppeteer Browser Pool...');
    this.sharedBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    });

    this.sharedBrowser.on('disconnected', () => {
      console.warn('[PDFService] Instância compartilhada do Puppeteer desconectada. Será recriada na próxima requisição.');
      this.sharedBrowser = null;
    });

    return this.sharedBrowser;
  }

  private ensureDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.pdfBaseDir)) {
      fs.mkdirSync(this.pdfBaseDir, { recursive: true });
    }
  }

  private fileToBase64DataUrl(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return '';
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).replace('.', '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private getSignatureBuffer(userPhone?: string): Buffer | null {
    try {
      if (userPhone) {
        const cleaned = userPhone.replace(/[^0-9]/g, '');
        const assetsDir = path.resolve(process.cwd(), 'assets', 'signatures');
        const customPng = path.join(assetsDir, `sig_${cleaned}.png`);
        const customJpg = path.join(assetsDir, `sig_${cleaned}.jpg`);
        if (fs.existsSync(customPng) && fs.statSync(customPng).size > 1000) return fs.readFileSync(customPng);
        if (fs.existsSync(customJpg) && fs.statSync(customJpg).size > 1000) return fs.readFileSync(customJpg);
      }

      const sigPath = path.resolve(process.cwd(), 'assets', 'signature.png');
      if (fs.existsSync(sigPath) && fs.statSync(sigPath).size > 1000) {
        return fs.readFileSync(sigPath);
      }
    } catch (e) {
      console.warn('[PDFService] Não foi possível carregar imagem de assinatura');
    }
    return null;
  }

  private getSignatureBase64(userPhone?: string): string {
    const buffer = this.getSignatureBuffer(userPhone);
    return buffer ? `data:image/png;base64,${buffer.toString('base64')}` : '';
  }

  /**
   * Preenche um PDF original estático/formulário usando pdf-lib
   */
  private async fillPDFWithPdfLib(
    pdfTemplatePath: string,
    data: ExtractedInspectionData,
    imagePaths: string[],
    configPath?: string
  ): Promise<string> {
    console.log(`[PDFService] Preenchendo PDF original com pdf-lib: ${pdfTemplatePath}`);

    const existingPdfBytes = await fs.promises.readFile(pdfTemplatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 1. Tenta preencher campos interativos de formulário (AcroForm) se existirem
    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      if (fields.length > 0) {
        console.log(`[PDFService] Formulário interativo detectado com ${fields.length} campos.`);
        const dataRecord = data as Record<string, any>;
        for (const field of fields) {
          const name = field.getName();
          if (dataRecord[name] !== undefined) {
            try {
              const textField = form.getTextField(name);
              textField.setText(String(dataRecord[name]));
            } catch {
              // Não é campo de texto simples
            }
          }
        }
      }
    } catch {
      // PDF não possui formulário interativo, usará escrita por coordenadas se houver json
    }

    // 2. Se houver um arquivo .json de configuração de coordenadas ou usa coordenadas padrão
    let coords: Record<string, any> | null = null;
    if (configPath && fs.existsSync(configPath)) {
      try {
        const configRaw = await fs.promises.readFile(configPath, 'utf8');
        coords = JSON.parse(configRaw);
      } catch (err) {
        console.warn('[PDFService] Erro ao aplicar coordenadas do JSON:', err);
      }
    }

    if (!coords) {
      const jsonFiles = fs.readdirSync(this.pdfBaseDir).filter((f) => f.endsWith('.json'));
      if (jsonFiles.length > 0) {
        try {
          const configRaw = await fs.promises.readFile(path.join(this.pdfBaseDir, jsonFiles[0]), 'utf8');
          coords = JSON.parse(configRaw);
        } catch {}
      }
    }

    if (!coords) {
      coords = {
        placa: { x: 100, y: 740, fontSize: 11, bold: true, page: 0 },
        modelo: { x: 230, y: 740, fontSize: 10, bold: true, page: 0 },
        ano: { x: 420, y: 740, fontSize: 10, page: 0 },
        cor: { x: 100, y: 715, fontSize: 10, page: 0 },
        quilometragem: { x: 230, y: 715, fontSize: 10, page: 0 },
        combustivel: { x: 420, y: 715, fontSize: 10, page: 0 },
        funilaria_pintura: { x: 100, y: 660, fontSize: 9, page: 0 },
        pneus_rodas: { x: 100, y: 620, fontSize: 9, page: 0 },
        vidros_farois: { x: 100, y: 580, fontSize: 9, page: 0 },
        interior_estofamento: { x: 100, y: 540, fontSize: 9, page: 0 },
        parecer_geral: { x: 100, y: 480, fontSize: 11, bold: true, page: 0 },
        observacoes: { x: 100, y: 430, fontSize: 9, page: 0 },
      };
    }

    try {
      const dataRecord = data as Record<string, any>;
      const pages = pdfDoc.getPages();

      for (const [key, pos] of Object.entries<any>(coords)) {
        const val = dataRecord[key];
        if (val !== undefined && pos.page !== undefined && pages[pos.page]) {
          const targetPage = pages[pos.page];
          targetPage.drawText(String(val), {
            x: pos.x || 50,
            y: pos.y || 50,
            size: pos.fontSize || 10,
            font: pos.bold ? boldFont : font,
            color: rgb(0, 0, 0),
          });
        }
      }
    } catch (err) {
      console.warn('[PDFService] Erro ao desenhar texto no PDF:', err);
    }

    // 3. Estampa de Assinatura
    const sigBuffer = this.getSignatureBuffer();
    if (sigBuffer && sigBuffer.length > 100) {
      try {
        const isJpg = sigBuffer[0] === 0xff && sigBuffer[1] === 0xd8;
        const sigImage = isJpg ? await pdfDoc.embedJpg(sigBuffer) : await pdfDoc.embedPng(sigBuffer);
        const firstPage = pdfDoc.getPages()[0];
        firstPage.drawImage(sigImage, {
          x: firstPage.getWidth() - 170,
          y: 40,
          width: 130,
          height: 50,
        });
      } catch (err) {
        console.warn('[PDFService] Aviso ao aplicar assinatura no PDF:', err);
      }
    }

    // 4. Anexa folha de fotos de vistoria no final do PDF se existirem imagens
    if (imagePaths && imagePaths.length > 0) {
      console.log(`[PDFService] Anexando ${imagePaths.length} foto(s) ao PDF original...`);
      let photoPage = pdfDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = photoPage.getSize();

      photoPage.drawText(`Anexo Fotográfico de Vistoria - Placa: ${data.placa}`, {
        x: 40,
        y: height - 40,
        size: 14,
        font: boldFont,
        color: rgb(0.1, 0.2, 0.5),
      });

      let currentX = 40;
      let currentY = height - 280;
      const imgWidth = 240;
      const imgHeight = 180;
      let itemsInPage = 0;

      for (let i = 0; i < imagePaths.length; i++) {
        const imgPath = imagePaths[i];
        if (!fs.existsSync(imgPath)) continue;

        try {
          const imgBytes = await fs.promises.readFile(imgPath);
          const isPng = imgPath.toLowerCase().endsWith('.png');
          const pdfImg = isPng ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);

          if (itemsInPage === 4) {
            photoPage = pdfDoc.addPage([595.28, 841.89]);
            currentX = 40;
            currentY = height - 280;
            itemsInPage = 0;

            photoPage.drawText(`Anexo Fotográfico de Vistoria - Placa: ${data.placa} (Cont.)`, {
              x: 40,
              y: height - 40,
              size: 14,
              font: boldFont,
              color: rgb(0.1, 0.2, 0.5),
            });
          }

          photoPage.drawImage(pdfImg, {
            x: currentX,
            y: currentY,
            width: imgWidth,
            height: imgHeight,
          });

          // Moldura em volta da foto
          photoPage.drawRectangle({
            x: currentX,
            y: currentY,
            width: imgWidth,
            height: imgHeight,
            borderColor: rgb(0.8, 0.8, 0.8),
            borderWidth: 1,
          });

          itemsInPage++;
          if (itemsInPage % 2 === 1) {
            currentX = 315; // Segunda coluna
          } else {
            currentX = 40;  // Primeira coluna
            currentY -= 210; // Próxima linha
          }
        } catch (imgErr) {
          console.warn(`[PDFService] Erro ao incorporar foto no PDF: ${imgPath}`, imgErr);
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfFilename = `Laudo_Vistoria_${data.placa}_${Date.now()}.pdf`;
    const pdfPath = path.join(this.outputDir, pdfFilename);

    await fs.promises.writeFile(pdfPath, pdfBytes);
    console.log(`[PDFService] PDF preenchido com sucesso em: ${pdfPath}`);
    return pdfPath;
  }

  /**
   * Renderiza PDF via Puppeteer e Handlebars (.hbs)
   */
  private async generatePDFWithPuppeteer(
    templatePath: string,
    data: ExtractedInspectionData,
    imagePaths: string[]
  ): Promise<string> {
    console.log(`[PDFService] Compilando template HTML (${templatePath}) para placa ${data.placa}...`);

    const templateSource = await fs.promises.readFile(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(templateSource);

    const base64Images = imagePaths
      .map((p) => this.fileToBase64DataUrl(p))
      .filter((url) => url.length > 0);

    const signatureImage = this.getSignatureBase64();

    const htmlContent = compiledTemplate({
      ...data,
      formattedDate: new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      images: base64Images,
      signatureImage,
    });

    console.log('[PDFService] Renderizando PDF via Puppeteer (Browser Pool)...');

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      const pdfFilename = `Laudo_Vistoria_${data.placa}_${Date.now()}.pdf`;
      const pdfPath = path.join(this.outputDir, pdfFilename);

      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          bottom: '20px',
          left: '20px',
          right: '20px',
        },
      });

      console.log(`[PDFService] PDF gerado via Puppeteer em: ${pdfPath}`);
      return pdfPath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Ponto de entrada principal para geração de laudos PDF.
   * Suporta modelos de escritórios em .pdf (pdf-lib) e .hbs (Puppeteer), com fallback automático.
   */
  public async generateInspectionPDF(
    data: ExtractedInspectionData,
    imagePaths: string[],
    officeTemplate?: string
  ): Promise<string> {
    try {
      data.cor = normalizeColorToFeminine(data.cor);

      let selectedPdfPath: string | null = null;
      let selectedJsonPath: string | undefined = undefined;

      if (officeTemplate) {
        // Se officeTemplate for o caminho completo de um arquivo PDF
        if (fs.existsSync(officeTemplate) && officeTemplate.toLowerCase().endsWith('.pdf')) {
          selectedPdfPath = officeTemplate;
          const jsonPath = officeTemplate.replace(/\.pdf$/i, '.json');
          if (fs.existsSync(jsonPath)) selectedJsonPath = jsonPath;
        } else {
          // Busca por nome flexível (sem acentos e case-insensitive)
          const cleanName = officeTemplate.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const files = fs.readdirSync(this.pdfBaseDir);
          const matchedPdf = files.find((f) =>
            f.toLowerCase().endsWith('.pdf') &&
            f.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(cleanName)
          );

          if (matchedPdf) {
            selectedPdfPath = path.join(this.pdfBaseDir, matchedPdf);
            const jsonFile = matchedPdf.replace(/\.pdf$/i, '.json');
            const potentialJsonPath = path.join(this.pdfBaseDir, jsonFile);
            if (fs.existsSync(potentialJsonPath)) selectedJsonPath = potentialJsonPath;
          } else {
            // Procura se existe um template .hbs específico
            const hbsPath = path.join(this.hbsTemplatesDir, `${officeTemplate}.hbs`);
            if (fs.existsSync(hbsPath)) {
              return await this.generatePDFWithPuppeteer(hbsPath, data, imagePaths);
            }
          }
        }
      }

      // Se nenhum modelo específico foi encontrado, verifica se existe QUALQUER PDF na pasta pdf_base
      if (!selectedPdfPath) {
        const basePdfs = fs.readdirSync(this.pdfBaseDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
        if (basePdfs.length > 0) {
          selectedPdfPath = path.join(this.pdfBaseDir, basePdfs[0]);
          console.log(`[PDFService] Usando ficha PDF da pasta pdf_base: ${selectedPdfPath}`);
          const jsonFile = basePdfs[0].replace(/\.pdf$/i, '.json');
          const potentialJsonPath = path.join(this.pdfBaseDir, jsonFile);
          if (fs.existsSync(potentialJsonPath)) selectedJsonPath = potentialJsonPath;
        }
      }

      // Se encontrou um PDF base (como ITAÚ - LAUDO DE VISTORIA - Copia.pdf), preenche ele
      if (selectedPdfPath && fs.existsSync(selectedPdfPath)) {
        return await this.fillPDFWithPdfLib(selectedPdfPath, data, imagePaths, selectedJsonPath);
      }

      // Fallback padrão: Puppeteer .hbs
      const defaultHbsPath = path.join(this.hbsTemplatesDir, 'inspection-report.hbs');
      return await this.generatePDFWithPuppeteer(defaultHbsPath, data, imagePaths);
    } catch (error) {
      console.error('[PDFService] Erro na geração do PDF:', error);
      throw error;
    }
  }
}

export const pdfService = new PDFService();
