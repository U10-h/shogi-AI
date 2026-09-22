const aborted=()=>new DOMException('対話を中止しました。','AbortError');

// The model owns one mutable decoding context. A new question waits until an
// interrupted decode has actually stopped, even though the UI unlocks at once.
export class TutorGenerationQueue {
  constructor(){this.tail=Promise.resolve();this.generation=0;}
  run(task){
    const generation=this.generation;
    const result=this.tail.then(async()=>{
      if(generation!==this.generation)throw aborted();
      const value=await task();
      if(generation!==this.generation)throw aborted();
      return value;
    });
    this.tail=result.catch(()=>{});
    return result;
  }
  interrupt(){this.generation++;}
}
