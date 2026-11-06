"""Compatibilidade para quem recebeu o instalador estático da DRE."""
def prepare(files):
    raise SystemExit("Instalador antigo desativado. Siga docs/PUBLICACAO.md. Nenhum arquivo foi alterado.")

if __name__ == "__main__":
    prepare({})
