"use server";
import prisma from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { requireUser } from "./shared";

export const uploadFile = async (file: File, dir: string, path: string) => {
  const bytes = await file.arrayBuffer();
  void dir; // directories are implicit in object storage
  await getStorage().put(path, new Uint8Array(bytes), file.type || undefined);
};

export const deleteFile = async (fileId: string) => {
  const user = await requireUser();

  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      Resume: { profile: { userId: user.id } },
    },
  });

  if (!file) {
    throw new Error("File not found or access denied");
  }

  await getStorage().delete(file.filePath);

  await prisma.file.delete({ where: { id: fileId } });
};
