import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UploadsService {
  constructor(private prisma: PrismaService) {}

  async createUploadRecord(data: {
    uploadedById: string;
    source: string;
    fileUrl: string;
  }) {
    // Destructure named fields instead of spreading — POST /uploads passes
    // the request body straight through, so a spread would let a crafted
    // payload set any valid CsvUpload column (id, status, successRows, …).
    const { uploadedById, source, fileUrl } = data;
    return this.prisma.csvUpload.create({
      data: { uploadedById, source, fileUrl, status: 'PENDING' },
    });
  }

  async updateUploadStatus(id: string, data: {
    status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED';
    totalRows?: number;
    successRows?: number;
    errorDetails?: string;
  }) {
    return this.prisma.csvUpload.update({ where: { id }, data });
  }

  async getUploads(uploadedById?: string) {
    return this.prisma.csvUpload.findMany({
      where: uploadedById ? { uploadedById } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
