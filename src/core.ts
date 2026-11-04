import{openDeviceStore,deviceStateTransaction}from'./device-storage';
import{outfitOptions}from'./outfit-options';
import type{PhotoJob}from'./photo-pipeline';
export type Category = 'top' | 'bottom' | 'dress' | 'shoes' | 'layer' | 'accessory';
export type AccessoryRole='bag'|'eyewear'|'watch'|'jewellery'|'other';
export const accessoryRole=(item:Item)=>item.accessoryRole??'other';
export interface Item {
    watchCropCheck?:import('./checked-watch-crop').CheckedWatchCrop;
    reviewNeeded?:boolean;
    /** Usability choice, never evidence of semantic accuracy or human review. */
    previewDecision?:'automatic'|'set-aside';
    accessoryRole?:AccessoryRole;
    synthetic?:boolean;
    prepared?:boolean;
    reviewNote?:string;
    reviewDraft?:{preview:boolean;acknowledged:boolean};
    id: string;
    sourceId: string;
    name: string;
    category: Category;
    image: string;
    partial: boolean;
    available: boolean;
    heels: boolean | null;
    sleeveless: boolean | null;
    confirmed: boolean;
    demo: boolean;
    sourceRefs?: string[];
    extraction?: 'sam-mask'|'model-source-crop';
    reconstruction?: {qualityWarning?:'faint_edge_fringe';originalImage?:string;framing?:import('./finished-image-quality').PreviewFraming;image:string;provider:'OpenAI';model:string;notice:string;sourceSha256:string;cutoutSha256:string;confirmed:boolean;reviewedByUser?:boolean};
    useReconstruction?:boolean;
}
export interface Source {
    /** Exact selected file, retained only for uploads made after backup v1. */
    original?: Blob;
    originalName?: string;
    originalLastModified?: number;
    imageKind?: 'normalized';
    sha256?:string;
    processing?:PhotoJob;
    synthetic?:boolean;
    id: string;
    name: string;
    image: Blob;
    demo: boolean;
    sourceRefs?: string[];
}
export interface Profile {
    occasion: string;
    style: string;
    noHeels: boolean;
    noSleeveless: boolean;
}
export interface Look {
    id: string;
    ids: string[];
    reason: string;
    profile: Profile;
}
export type WardrobeView={kind:'own'}|{kind:'samples'}|{kind:'sample';id:string};
export interface State {
    wardrobeView?:WardrobeView;
    items: Item[];
    sources: Source[];
    pending: Item[];
    looks: Look[];
    profile: Profile;
    drafts?: Look[];
    outfitHistory?: string[];
}
export const initial = (): State => ({ items: [], sources: [], pending: [], looks: [], profile: { occasion: 'Dinner', style: 'Relaxed', noHeels: false, noSleeveless: false } });
// Retired normal-UI filters must never survive invisibly in stored profiles/looks.
export function disableRetiredWearPreferences(state:State){let changed=false;for(const profile of [state.profile,...state.looks.map(look=>look.profile),...(state.drafts??[]).map(look=>look.profile)]){if(profile.noHeels||profile.noSleeveless)changed=true;profile.noHeels=false;profile.noSleeveless=false;}return changed;}
export function eligible(items: Item[], p: Profile) { return items.filter(i => i.confirmed && !i.reviewNeeded && !(i.extraction==='model-source-crop'&&(!i.reconstruction?.confirmed||i.useReconstruction!==true)) && i.available && (!p.noHeels || i.category !== 'shoes' || i.heels === false) && (!p.noSleeveless || !['top', 'dress'].includes(i.category) || i.sleeveless === false)); }
export function validate(ids: string[], items: Item[], p: Profile) { const pool = eligible(items, p); if (new Set(ids).size !== ids.length || ids.some(id => !pool.some(i => i.id === id)))
    return false; const cats = ids.map(id => pool.find(i => i.id === id)!.category); const count=(category:Category)=>cats.filter(c=>c===category).length;return count('shoes')<=1&&count('layer')<=1&&count('accessory')<=5&&new Set(pool.filter(i=>ids.includes(i.id)&&i.category==='accessory').map(accessoryRole)).size===count('accessory')&&((count('dress')===1&&count('top')===0&&count('bottom')===0)||(count('dress')===0&&count('top')===1&&count('bottom')===1)); }
export function suggest(items: Item[], p: Profile, seen:string[]=[]): Look[] {
 const {picked,total,exhausted}=outfitOptions(eligible(items,p),p,seen);
 return picked.map(parts=>({id:crypto.randomUUID(),ids:parts.map(i=>i.id),profile:{...p},reason:`A starting point for ${p.occasion.toLowerCase()}. ${new Set(parts.map(i=>i.sourceId)).size>1?'Pieces from different photos are mixed together. ':''}${p.style==='Minimal'?'Extra layers and accessories are left out. ':''}${total<=3?'Your current wardrobe offers only a few combinations for this occasion. ':''}${exhausted?'You have seen the available combinations; try swapping a piece. ':''}Check that it suits your plans.`}));
}
export function removeItem(s: State, id: string) { s.items = s.items.filter(i => i.id !== id); s.looks = s.looks.filter(l => !l.ids.includes(id)); }
export function removeSource(s: State, id: string) { s.sources = s.sources.filter(x => x.id !== id); s.pending = s.pending.filter(x => x.sourceId !== id); for (const i of s.items.filter(x => x.sourceId === id))
    removeItem(s, i.id); }
export function merge(s: State, c: Item, id: string) { const item = s.items.find(i => i.id === id); if (!item || item.category !== c.category)
    throw Error('Choose a matching category.'); item.sourceRefs = Array.from(new Set([...(item.sourceRefs ?? [item.sourceId]), c.sourceId])); s.pending = s.pending.filter(i => i.id !== c.id); }
export const DB = 'nothing-to-wear-v1';
export async function database() { return openDeviceStore(DB); }
export async function load(): Promise<State> { const db=await database();return (await deviceStateTransaction<State|undefined>(db,'readonly',store=>store.get('current')))??initial(); }
export async function persist(s:State) { const db=await database();await deviceStateTransaction(db,'readwrite',store=>store.put(s,'current')); }
