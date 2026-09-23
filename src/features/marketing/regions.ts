const pairs =
  "afgAF alaAX albAL dzaDZ asmAS andAD agoAO aiaAI ataAQ atgAG argAR armAM abwAW ausAU autAT azeAZ bhsBS bhrBH bgdBD brbBB blrBY belBE blzBZ benBJ bmuBM btnBT bolBO besBQ bihBA bwaBW bvtBV braBR iotIO brnBN bgrBG bfaBF bdiBI cpvCV khmKH cmrCM canCA cymKY cafCF tcdTD chlCL chnCN cxrCX cckCC colCO comKM cogCG codCD cokCK criCR civCI hrvHR cubCU cuwCW cypCY czeCZ dnkDK djiDJ dmaDM domDO ecuEC egyEG slvSV gnqGQ eriER estEE swzSZ ethET flkFK froFO fjiFJ finFI fraFR gufGF pyfPF atfTF gabGA gmbGM geoGE deuDE ghaGH gibGI grcGR grlGL grdGD glpGP gumGU gtmGT ggyGG ginGN gnbGW guyGY htiHT hmdHM vatVA hndHN hkgHK hunHU islIS indIN idnID irnIR irqIQ irlIE imnIM isrIL itaIT jamJM jpnJP jeyJE jorJO kazKZ kenKE kirKI prkKP korKR kwtKW kgzKG laoLA lvaLV lbnLB lsoLS lbrLR lbyLY lieLI ltuLT luxLU macMO mdgMG mwiMW mysMY mdvMV mliML mltMT mhlMH mtqMQ mrtMR musMU mytYT mexMX fsmFM mdaMD mcoMC mngMN mneME msrMS marMA mozMZ mmrMM namNA nruNR nplNP nldNL nclNC nzlNZ nicNI nerNE ngaNG niuNU nfkNF mkdMK mnpMP norNO omnOM pakPK plwPW psePS panPA pngPG pryPY perPE phlPH pcnPN polPL prtPT priPR qatQA reuRE rouRO rusRU rwaRW blmBL shnSH knaKN lcaLC mafMF spmPM vctVC wsmWS smrSM stpST sauSA senSN srbRS sycSC sleSL sgpSG sxmSX svkSK svnSI slbSB somSO zafZA sgsGS ssdSS espES lkaLK sdnSD surSR sjmSJ sweSE cheCH syrSY twnTW tjkTJ tzaTZ thaTH tlsTL tgoTG tklTK tonTO ttoTT tunTN turTR tkmTM tcaTC tuvTV ugaUG ukrUA areAE gbrGB usaUS umiUM uryUY uzbUZ vutVU venVE vnmVN vgbVG virVI wlfWF eshEH yemYE zmbZM zweZW xkkXK";

export const regionCodes = new Map(pairs.split(" ").map((pair) => [pair.slice(0, 3), pair.slice(3)]));

const names = new Map<string, Intl.DisplayNames>();

export function regionName(code: string, locale: "zh" | "en") {
  const raw = code.trim();
  const short = /^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : regionCodes.get(raw.toLowerCase());
  if (!short) return raw && !/^(?:zzz|\(not set\))$/i.test(raw) ? raw.toUpperCase() : "—";
  let display = names.get(locale);
  if (!display) {
    display = new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "region" });
    names.set(locale, display);
  }
  try {
    return display.of(short) ?? short;
  } catch {
    return short;
  }
}
