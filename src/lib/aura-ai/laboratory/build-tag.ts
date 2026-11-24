// FASE IA-3C — etiqueta de versão do Laboratório. Motivo: o commit da FASE IA-3 estava mergeado no
// histórico do Lovable, mas o texto copiado de uma rodada real não trazia nenhuma das linhas novas
// daquela fase ("diag:"/"verificação:") e o pt-BR do servidor (normalizePtBrNumbers) não tinha sido
// aplicado — ou seja, não havia como saber, só olhando a tela, se o bundle publicado era mesmo o do
// commit IA-3 ou uma versão anterior ainda no ar. Esta constante dá uma prova visível e comparável:
// o cliente (bundle da TELA) importa este mesmo arquivo, e o servidor devolve seu próprio valor em
// getLabStatus/runLabQuestion — se os dois baterem, a publicação pegou os dois lados; se não, algum
// dos dois ainda está desatualizado.
//
// Regra: constante LITERAL (nunca derivada de git SHA, data ou variável de ambiente — isso exigiria
// infraestrutura extra fora do escopo desta fase), atualizada À MÃO toda vez que uma fase futura
// tocar em src/lib/aura-ai/laboratory/* ou na tela do Laboratório.
export const LAB_BUILD_TAG = "IA-3C";
