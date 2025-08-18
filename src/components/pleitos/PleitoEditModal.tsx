
import React, { useState, useEffect } from 'react';
import { Pleito, Analista, TipoPleitoEnum, StatusPleito, SessaoAnalise, Anotacao } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { Save, PlusCircle, MessageSquare } from 'lucide-react';
import { SESSAO_ANALISE_DISPLAY_NAMES } from '../../constants';

interface PleitoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  pleito: Pleito | null;
  onSave: (pleito: Pleito) => void;
  analistas: Analista[];
}

const PleitoEditModal: React.FC<PleitoEditModalProps> = ({ isOpen, onClose, pleito, onSave, analistas }) => {
  const [formData, setFormData] = useState<Partial<Pleito> & { responsavelId?: string }>({});
  const [newAnotacao, setNewAnotacao] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    if (pleito) {
      setFormData({ ...pleito, responsavelId: pleito.responsavel?.id || '' });
    } else {
      setFormData({
        tipoPleito: TipoPleitoEnum.Outro,
        status: StatusPleito.Pendente,
        sessaoAnalise: SessaoAnalise.SEM_SESSAO,
        anotacoes: [],
        responsavelId: ''
      });
    }
  }, [pleito, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleAnotacaoAdd = () => {
    if (newAnotacao.trim() && user) {
        const anotacao: Anotacao = {
            id: `anot-${Date.now()}`,
            autor: user.nome,
            texto: newAnotacao.trim(),
            data: new Date().toISOString()
        };
        setFormData(prev => ({...prev, anotacoes: [...(prev.anotacoes || []), anotacao]}));
        setNewAnotacao('');
    }
  };

  const handleSave = () => {
    if (!formData.ncm || !formData.produto || !formData.prazo) {
      alert('Por favor, preencha os campos NCM, Produto e Prazo.');
      return;
    }
    
    const { responsavelId, ...pleitoData } = formData;
    const finalPleito = { ...pleitoData } as Pleito;

    if (responsavelId) {
      finalPleito.responsavel = analistas.find(a => a.id === responsavelId);
    } else {
      delete finalPleito.responsavel;
    }
    
    onSave(finalPleito);
  };

  const renderDynamicFields = () => {
    const commonMercosulFields = (
        <>
            <Input label="País/Estado Parte" name="paisEstadoParte" value={String(formData.paisEstadoParte ?? '')} onChange={handleChange} />
            <Input label="Situação" name="situacaoEspecifica" value={String(formData.situacaoEspecifica ?? '')} onChange={handleChange} />
            <Textarea label="Redução do II" name="reducaoII" value={String(formData.reducaoII ?? '')} onChange={handleChange} />
        </>
    );

    switch (formData.sessaoAnalise) {
        case SessaoAnalise.CCM_ANALISE:
        case SessaoAnalise.CCM_PENDENTES_BR:
            return (
                 <>
                    <Input label="Redução do II (%)" name="reducaoII" value={String(formData.reducaoII ?? '')} onChange={handleChange} />
                    <Input label="Quota (Valor)" name="quotaValor" value={String(formData.quotaValor ?? '')} onChange={handleChange} />
                    <Input label="País Pendente e Prazo" name="paisPendente" value={String(formData.paisPendente ?? '')} onChange={handleChange} />
                    <Textarea label="Situação Específica" name="situacaoEspecifica" value={String(formData.situacaoEspecifica ?? '')} onChange={handleChange} />
                </>
            );
        case SessaoAnalise.CCM_PENDENTES_MERCOSUL:
             return commonMercosulFields;
        
        case SessaoAnalise.PENDENTES_CAT:
        case SessaoAnalise.NOVOS_CAT:
             return (
                <>
                    <Input label="Ex-tarifário" name="exTarifario" value={String(formData.exTarifario ?? '')} onChange={handleChange} />
                    <Input label="TEC (Pleito a 0%)" name="tec" value={String(formData.tec ?? '')} onChange={handleChange} />
                    <Input label="Quota" name="quotaValor" value={String(formData.quotaValor ?? '')} onChange={handleChange} />
                    <Input label="Unidade Quota" name="quotaUnidade" value={String(formData.quotaUnidade ?? '')} onChange={handleChange} />
                    <Input label="Término Vigência" name="terminoVigenciaMedida" value={String(formData.terminoVigenciaMedida ?? '')} onChange={handleChange} />
                    <Textarea label="Notas Técnicas" name="notaTecnica" value={String(formData.notaTecnica ?? '')} onChange={handleChange} />
                    <Textarea label="Posição CAT" name="posicaoCAT" value={String(formData.posicaoCAT ?? '')} onChange={handleChange} />
                </>
            );

        case SessaoAnalise.CAT_MERCOSUL_PENDENTES:
        case SessaoAnalise.CAT_MERCOSUL_NOVOS:
            return (
                <>
                   {commonMercosulFields}
                   <Input label="Alíquota Solicitada" name="aliquotaPretendida" value={String(formData.aliquotaPretendida ?? '')} onChange={handleChange} />
                   <Input label="Prazo Medida Vigente" name="prazo" value={String(formData.prazo ?? '')} onChange={handleChange} type="date" />
                </>
            );
        
        case SessaoAnalise.LETEC_PENDENTES:
        case SessaoAnalise.LETEC_NOVOS:
        case SessaoAnalise.RENOVACAO_LETEC:
            return (
                <>
                    <Input label="Alíquota Aplicada" name="aliquotaAplicada" value={String(formData.aliquotaAplicada ?? '')} onChange={handleChange} />
                    <Input label="Alíquota Pretendida" name="aliquotaPretendida" value={String(formData.aliquotaPretendida ?? '')} onChange={handleChange} />
                    <Textarea label="Notas Técnicas" name="notaTecnica" value={String(formData.notaTecnica ?? '')} onChange={handleChange} />
                </>
            );

        case SessaoAnalise.CMC2715_PENDENTES:
        case SessaoAnalise.CMC2715_NOVOS:
            return (
                <>
                    <Input label="Alíquota II Vigente" name="aliquotaIIVigente" value={String(formData.aliquotaIIVigente ?? '')} onChange={handleChange} />
                    <Input label="Alíquota II Pleiteada" name="aliquotaIIPleiteada" value={String(formData.aliquotaIIPleiteada ?? '')} onChange={handleChange} />
                </>
            );

        case SessaoAnalise.LEBIT_PENDENTES:
        case SessaoAnalise.LEBIT_NOVOS:
            return (
                <>
                    <Input label="Ex-tarifário" name="exTarifario" value={String(formData.exTarifario ?? '')} onChange={handleChange} />
                    <Input label="TEC" name="tec" value={String(formData.tec ?? '')} onChange={handleChange} />
                    <Input label="Alíquota Aplicada" name="aliquotaAplicada" value={String(formData.aliquotaAplicada ?? '')} onChange={handleChange} />
                    <Input label="Alíquota Pretendida" name="aliquotaPretendida" value={String(formData.aliquotaPretendida ?? '')} onChange={handleChange} />
                </>
            );
        
        case SessaoAnalise.CT1_PENDENTES:
        case SessaoAnalise.CT1_NOVOS:
             return (
                <>
                    <Input label="Alteração Tarifária" name="alteracaoTarifaria" value={String(formData.alteracaoTarifaria ?? '')} onChange={handleChange} />
                    <Textarea label="Pleito (Detalhado)" name="tipoPleitoDetalhado" value={String(formData.tipoPleitoDetalhado ?? '')} onChange={handleChange} />
                </>
            );

        default:
            return <p className="text-sm text-gray-500 col-span-full">Não há campos específicos para esta seção de análise.</p>;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={pleito ? 'Editar Pleito' : 'Criar Novo Pleito'} size="full">
      <div className="space-y-6">
        
        {/* Section 1: Configuração do Pleito */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark">Configuração do Pleito</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select label="Seção de Análise" name="sessaoAnalise" value={String(formData.sessaoAnalise ?? '')} onChange={handleChange} required>
                {Object.values(SessaoAnalise).map(s => <option key={s} value={s}>{SESSAO_ANALISE_DISPLAY_NAMES[s]}</option>)}
              </Select>
              <Input label="NCM" name="ncm" value={String(formData.ncm ?? '')} onChange={handleChange} required />
              <Input label="Produto" name="produto" value={String(formData.produto ?? '')} onChange={handleChange} required />
              <Input label="Pleiteante" name="pleiteante" value={String(formData.pleiteante ?? '')} onChange={handleChange} />
              <Select label="Tipo de Pleito" name="tipoPleito" value={String(formData.tipoPleito ?? '')} onChange={handleChange} required>
                {Object.values(TipoPleitoEnum).map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Input label="Prazo" name="prazo" type="date" value={String(formData.prazo ?? '')} onChange={handleChange} required />
            </div>
        </fieldset>
        
        {/* Section 2: Dynamic Fields */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark">Detalhes da Análise (Contextual)</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {renderDynamicFields()}
            </div>
        </fieldset>
        
        {/* Section 3: Processo */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark">Informações do Processo</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Processo SEI Público" name="processoSEIPublico" value={String(formData.processoSEIPublico ?? '')} onChange={handleChange} />
                <Input label="Processo SEI Restrito" name="processoSEIRestrito" value={String(formData.processoSEIRestrito ?? '')} onChange={handleChange} />
            </div>
        </fieldset>


        {/* Section 4: Análise Interna */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark">Subsídio CGIM (Análise Interna)</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Textarea label="Resumo do Pleito" name="resumoPleito" value={String(formData.resumoPleito ?? '')} onChange={handleChange} />
              <Textarea label="Dados de Comércio" name="dadosComercio" value={String(formData.dadosComercio ?? '')} onChange={handleChange} />
              <Textarea label="Análise Técnica" name="analiseTecnica" value={String(formData.analiseTecnica ?? '')} onChange={handleChange} />
              <Textarea label="Sugestão CGIM" name="sugestaoCGIM" value={String(formData.sugestaoCGIM ?? '')} onChange={handleChange} />
            </div>
        </fieldset>

        {/* Section 5: Gestão */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark">Gestão do Processo (CGIM)</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select label="Status" name="status" value={String(formData.status ?? '')} onChange={handleChange} required>
                {Object.values(StatusPleito).map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select label="Responsável" name="responsavelId" value={String(formData.responsavelId ?? '')} onChange={handleChange}>
                <option value="">Não atribuído</option>
                {analistas.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
              <Input label="Data de Distribuição" name="dataDistribuicao" type="date" value={String(formData.dataDistribuicao ?? '')} onChange={handleChange} />
            </div>
        </fieldset>
        
        {/* Section 6: Anotações */}
        <fieldset className="border p-4 rounded-md">
            <legend className="px-2 font-semibold text-cgim-blue-dark flex items-center"><MessageSquare size={16} className="mr-2"/>Anotações Internas</legend>
            <div className="space-y-4">
                <div className="max-h-40 overflow-y-auto space-y-3 pr-2">
                    {formData.anotacoes && formData.anotacoes.length > 0 ? formData.anotacoes.map(anot => (
                        <div key={anot.id} className="bg-cgim-blue-light p-3 rounded-md">
                            <p className="text-sm text-gray-800">{anot.texto}</p>
                            <p className="text-xs text-right text-gray-600 mt-1">- {anot.autor} em {new Date(anot.data).toLocaleString('pt-BR')}</p>
                        </div>
                    )) : <p className="text-sm text-gray-500">Nenhuma anotação adicionada.</p>}
                </div>
                 <div className="flex items-start space-x-2">
                    <Textarea label="Adicionar Anotação" id="newAnotacao" value={newAnotacao} onChange={(e) => setNewAnotacao(e.target.value)} />
                    <Button onClick={handleAnotacaoAdd} className="mt-7" icon={<PlusCircle size={16}/>}>Adicionar</Button>
                </div>
            </div>
        </fieldset>

        <div className="flex justify-end space-x-3 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} icon={<Save size={18}/>}>Salvar Pleito</Button>
        </div>
      </div>
    </Modal>
  );
};

export default PleitoEditModal;
