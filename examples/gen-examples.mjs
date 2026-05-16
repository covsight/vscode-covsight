/**
 * Generates example .cdb coverage databases for the vscode-covsight extension.
 * Run with: node examples/gen-examples.mjs
 */
import { MemUCIS, CoverTypeT, HistoryNodeKind } from '../node_modules/@covsight/core/dist/index.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to add a test run history node
function addTestRun(ucis, name, status = 1 /* PASSED */) {
    const node = ucis.createHistoryNode(HistoryNodeKind.TEST, name);
    node.testStatus = status;
    return node;
}

// ─── Example 1: uart_ctrl — realistic UART controller coverage ───────────────
async function buildUartCtrl() {
    const ucis = new MemUCIS();
    ucis.writtenBy = 'vcs';
    ucis.writtenTime = Math.floor(Date.now() / 1000);

    addTestRun(ucis, 'uart_basic_tx');
    addTestRun(ucis, 'uart_basic_rx');
    addTestRun(ucis, 'uart_loopback');

    const fh = ucis.getFileHandle('rtl/uart_ctrl.sv');

    // ── Top-level design unit ──
    const du = ucis.createScope('uart_ctrl');
    const inst = du.createCovergroupDef('baud_rate_cg', fh);
    const top = inst.createCovergroupInstance('baud_rate_cg', fh);

    // Baud rate coverpoint — all bins hit
    const baudCp = top.createCoverpoint('baud_rate', fh);
    baudCp.createBin('BAUD_9600',   CoverTypeT.CVGBIN, 42n, 1n);
    baudCp.createBin('BAUD_19200',  CoverTypeT.CVGBIN, 15n, 1n);
    baudCp.createBin('BAUD_38400',  CoverTypeT.CVGBIN, 8n,  1n);
    baudCp.createBin('BAUD_57600',  CoverTypeT.CVGBIN, 3n,  1n);
    baudCp.createBin('BAUD_115200', CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT

    // Parity mode coverpoint — partially covered
    const parCp = top.createCoverpoint('parity_mode', fh);
    parCp.createBin('NONE', CoverTypeT.CVGBIN, 55n, 1n);
    parCp.createBin('ODD',  CoverTypeT.CVGBIN, 12n, 1n);
    parCp.createBin('EVEN', CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT

    // Stop bits coverpoint — all hit
    const stopCp = top.createCoverpoint('stop_bits', fh);
    stopCp.createBin('ONE', CoverTypeT.CVGBIN, 67n, 1n);
    stopCp.createBin('TWO', CoverTypeT.CVGBIN, 4n,  1n);

    // ── Toggle coverage for key signals ──
    const txMod = ucis.createScope('uart_tx', du);
    const txToggle = txMod.createToggle('tx_out', fh);
    txToggle.createToggleBin('0 -> 1', 128n, 1n);
    txToggle.createToggleBin('1 -> 0', 126n, 1n);

    const rxMod = ucis.createScope('uart_rx', du);
    const rxToggle = rxMod.createToggle('rx_in', fh);
    rxToggle.createToggleBin('0 -> 1', 89n, 1n);
    rxToggle.createToggleBin('1 -> 0', 0n, 1n); // NOT HIT

    // ── FSM state coverage ──
    const fsmDu = ucis.createScope('uart_fsm', du);
    const fsmCg = fsmDu.createCovergroupDef('state_cg', fh);
    const fsmInst = fsmCg.createCovergroupInstance('state_cg', fh);
    const stateCp = fsmInst.createCoverpoint('state', fh);
    stateCp.createBin('IDLE',      CoverTypeT.CVGBIN, 200n, 1n);
    stateCp.createBin('START_BIT', CoverTypeT.CVGBIN, 67n,  1n);
    stateCp.createBin('DATA',      CoverTypeT.CVGBIN, 64n,  1n);
    stateCp.createBin('PARITY',    CoverTypeT.CVGBIN, 0n,   1n); // NOT HIT
    stateCp.createBin('STOP_BIT',  CoverTypeT.CVGBIN, 64n,  1n);

    await ucis.write(path.join(__dirname, 'uart_ctrl.cdb'));
    console.log('✓ uart_ctrl.cdb');
}

// ─── Example 2: alu_coverage — arithmetic logic unit, high coverage ───────────
async function buildAluCoverage() {
    const ucis = new MemUCIS();
    ucis.writtenBy = 'xcelium';
    ucis.writtenTime = Math.floor(Date.now() / 1000);

    addTestRun(ucis, 'alu_smoke');
    addTestRun(ucis, 'alu_arith_ops');
    addTestRun(ucis, 'alu_logic_ops');
    addTestRun(ucis, 'alu_shift_ops');
    addTestRun(ucis, 'alu_corner_cases');

    const fh = ucis.getFileHandle('rtl/alu.sv');

    const du = ucis.createScope('alu');

    // Operation type coverage — nearly complete
    const opCg = du.createCovergroupDef('opcode_cg', fh);
    const opInst = opCg.createCovergroupInstance('opcode_cg', fh);
    const opCp = opInst.createCoverpoint('opcode', fh);
    const ops = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'MUL'];
    ops.forEach((op, i) => opCp.createBin(op, CoverTypeT.CVGBIN, BigInt(20 + i * 7), 1n));

    // Overflow conditions
    const ovfCg = du.createCovergroupDef('overflow_cg', fh);
    const ovfInst = ovfCg.createCovergroupInstance('overflow_cg', fh);
    const ovfCp = ovfInst.createCoverpoint('overflow', fh);
    ovfCp.createBin('NO_OVF',  CoverTypeT.CVGBIN, 150n, 1n);
    ovfCp.createBin('POS_OVF', CoverTypeT.CVGBIN, 8n,   1n);
    ovfCp.createBin('NEG_OVF', CoverTypeT.CVGBIN, 3n,   1n);

    // Zero result
    const zeroCg = du.createCovergroupDef('zero_result_cg', fh);
    const zeroInst = zeroCg.createCovergroupInstance('zero_result_cg', fh);
    const zeroCp = zeroInst.createCoverpoint('zero_flag', fh);
    zeroCp.createBin('ZERO',    CoverTypeT.CVGBIN, 14n, 1n);
    zeroCp.createBin('NONZERO', CoverTypeT.CVGBIN, 186n, 1n);

    // Toggle coverage — fully covered
    for (const sig of ['a_in', 'b_in', 'result_out', 'carry_out', 'zero_out']) {
        const tog = du.createToggle(sig, fh);
        tog.createToggleBin('0 -> 1', BigInt(40 + Math.floor(Math.random() * 60)), 1n);
        tog.createToggleBin('1 -> 0', BigInt(38 + Math.floor(Math.random() * 60)), 1n);
    }

    await ucis.write(path.join(__dirname, 'alu_coverage.cdb'));
    console.log('✓ alu_coverage.cdb');
}

// ─── Example 3: soc_top — multi-block SoC, low coverage (work in progress) ───
async function buildSocTop() {
    const ucis = new MemUCIS();
    ucis.writtenBy = 'modelsim';
    ucis.writtenTime = Math.floor(Date.now() / 1000);

    addTestRun(ucis, 'soc_power_on');

    const fhTop  = ucis.getFileHandle('rtl/soc_top.sv');
    const fhCpu  = ucis.getFileHandle('rtl/cpu_core.sv');
    const fhMem  = ucis.getFileHandle('rtl/mem_ctrl.sv');
    const fhDma  = ucis.getFileHandle('rtl/dma_engine.sv');

    // ── CPU core ──
    const cpu = ucis.createScope('cpu_core');
    const cpuCg = cpu.createCovergroupDef('instr_cg', fhCpu);
    const cpuInst = cpuCg.createCovergroupInstance('instr_cg', fhCpu);
    const instrCp = cpuInst.createCoverpoint('instruction', fhCpu);
    instrCp.createBin('LOAD',   CoverTypeT.CVGBIN, 5n,  1n);
    instrCp.createBin('STORE',  CoverTypeT.CVGBIN, 3n,  1n);
    instrCp.createBin('ADD',    CoverTypeT.CVGBIN, 2n,  1n);
    instrCp.createBin('BRANCH', CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    instrCp.createBin('JUMP',   CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    instrCp.createBin('CALL',   CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    instrCp.createBin('RET',    CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    instrCp.createBin('IRQ',    CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT

    // ── Memory controller ──
    const mem = ucis.createScope('mem_ctrl');
    const memCg = mem.createCovergroupDef('access_cg', fhMem);
    const memInst = memCg.createCovergroupInstance('access_cg', fhMem);
    const accessCp = memInst.createCoverpoint('access_type', fhMem);
    accessCp.createBin('READ',       CoverTypeT.CVGBIN, 12n, 1n);
    accessCp.createBin('WRITE',      CoverTypeT.CVGBIN, 4n,  1n);
    accessCp.createBin('BURST_READ', CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    accessCp.createBin('BURST_WR',   CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    accessCp.createBin('REFRESH',    CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT

    // ── DMA engine — barely exercised ──
    const dma = ucis.createScope('dma_engine');
    const dmaCg = dma.createCovergroupDef('xfer_cg', fhDma);
    const dmaInst = dmaCg.createCovergroupInstance('xfer_cg', fhDma);
    const xferCp = dmaInst.createCoverpoint('transfer_size', fhDma);
    xferCp.createBin('BYTE',   CoverTypeT.CVGBIN, 1n,  1n);
    xferCp.createBin('HALF',   CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    xferCp.createBin('WORD',   CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    xferCp.createBin('DWORD',  CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT
    xferCp.createBin('BURST8', CoverTypeT.CVGBIN, 0n,  1n); // NOT HIT

    // Toggle coverage — many signals not toggled
    for (const [mod, fh, sigs] of [
        ['cpu', fhCpu,  ['clk', 'rst_n', 'irq', 'ack']],
        ['mem', fhMem,  ['rd_en', 'wr_en', 'busy', 'err']],
        ['dma', fhDma,  ['req', 'grant', 'done', 'err']],
    ]) {
        const scope = ucis.createScope(mod, cpu);  // nest under cpu for demo
        for (const [i, sig] of sigs.entries()) {
            const tog = scope.createToggle(sig, fh);
            const hit = i < 2 ? BigInt(10 + i) : 0n;
            tog.createToggleBin('0 -> 1', hit, 1n);
            tog.createToggleBin('1 -> 0', hit > 0n ? hit - 1n : 0n, 1n);
        }
    }

    await ucis.write(path.join(__dirname, 'soc_top.cdb'));
    console.log('✓ soc_top.cdb');
}

// ─── Run all generators ───────────────────────────────────────────────────────
await buildUartCtrl();
await buildAluCoverage();
await buildSocTop();
console.log('\nDone. Example .cdb files written to examples/');
