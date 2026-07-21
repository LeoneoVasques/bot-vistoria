import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { ExtractedInspectionData } from '../ai/gpt.service';

export class PDFService {
  private outputDir = path.resolve(process.cwd(), 'output');
  private getTemplatePath(): string {
    const devPath = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates', 'inspection-report.hbs');
    if (fs.existsSync(devPath)) return devPath;

    const prodPath = path.resolve(process.cwd(), 'dist', 'modules', 'pdf', 'templates', 'inspection-report.hbs');
    if (fs.existsSync(prodPath)) return prodPath;

    return path.resolve(__dirname, 'templates', 'inspection-report.hbs');
  }

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
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

  private getSignatureBase64(): string {
    try {
      const sigPath = path.resolve(process.cwd(), 'assets', 'signature.png');
      if (fs.existsSync(sigPath)) {
        const buffer = fs.readFileSync(sigPath);
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (e) {
      console.warn('[PDFService] Não foi possível carregar assets/signature.png');
    }
    return '';
  }

  public async generateInspectionPDF(
    data: ExtractedInspectionData,
    imagePaths: string[]
  ): Promise<string> {
    try {
      console.log(`[PDFService] Compilando template HTML para laudo da placa ${data.placa}...`);

      const templatePath = this.getTemplatePath();
      const templateSource = await fs.promises.readFile(templatePath, 'utf8');
      const compiledTemplate = handlebars.compile(templateSource);

      // Converte caminhos locais de imagens para Data URL base64 para o Puppeteer
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

      console.log('[PDFService] Renderizando PDF via Puppeteer...');

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
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

      await browser.close();

      console.log(`[PDFService] PDF gerado com sucesso em: ${pdfPath}`);
      return pdfPath;
    } catch (error) {
      console.error('[PDFService] Erro na geração de PDF:', error);
      throw error;
    }
  }
}

export const pdfService = new PDFService();
